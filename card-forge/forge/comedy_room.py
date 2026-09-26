"""One bounded challenge/revision exchange; never asks the LLM to pick a winner."""
from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from .logging_setup import get_logger
from .models import CardCandidate
from .personas import writing_team
from .prompts import INJECTION_NOTICE, wrap_feed_data

PAIRS = (("writer.deadpan", "writer.unhinged"),
         ("writer.pr_spin_doctor", "writer.banned_from_4chan"),
         ("writer.petty_villain", "writer.hatemonger"))
PARTNERS = {a: b for pair in PAIRS for a, b in (pair, pair[::-1])}
PARTNERS['writer.toxic_positivity'] = 'writer.banned_from_4chan'
PARTNERS['writer.intrusive_thoughts'] = 'writer.deadpan'
FORMAT = ('Prompts have exactly one ____ accepting an unrelated noun phrase. '
          'Answers are short standalone acts, objects, or situations with no blank. '
          'Preserve each source card kind. Return JSON only. ')


def _indexed(data, key, size):
    rows = data.get(key) if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError(f'comedy room response requires {key} list')
    result, duplicate = {}, set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        idx = row.get('index')
        if type(idx) is not int or not 0 <= idx < size:
            continue
        if idx in result:
            duplicate.add(idx)
        result[idx] = row
    return {i: row for i, row in result.items() if i not in duplicate}


def _suggestion(row, original, author):
    try:
        card = CardCandidate(kind=row.get('kind'), text=row.get('text'), writer=author)
        if card.kind != original.kind or (card.kind == 'prompt' and card.blanks != 1):
            return None
        return card
    except (ValueError, TypeError):
        return None


class ComedyRoom:
    def __init__(self, llm, settings, emit=None, writer_names=None, definitions=None, writers=None):
        self.writer_names = writer_names
        self.definitions = definitions
        self.writers = writers
        self.llm, self.settings = llm, settings
        self.emit = emit
        self.run_id = uuid4().hex

    def record(self, event):
        event = {'run_id': self.run_id, **event}
        # Write after every call so earlier drafts survive a later call failure.
        if self.settings.comedy_trace_path:
            path = Path(self.settings.comedy_trace_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('a', encoding='utf-8') as output:
                output.write(json.dumps(event, ensure_ascii=False) + '\n')
        if self.emit:
            self.emit(event)
        else:
            get_logger().info('comedy.exchange', extra={'extra_fields': event})

    def run(self, themes):
        writers = self.writers or writing_team(self.llm, self.settings, names=self.writer_names, definitions=self.definitions)
        by_name = {writer.name: writer for writer in writers}
        final = []
        by_writer = themes if isinstance(themes, dict) else {w.name: themes for w in writers}
        for theme_number in range(max((len(ts) for ts in by_writer.values()), default=0)):
            drafts, contexts = {}, {}
            # Everyone writes blind from their own research before challenges.
            for writer in writers:
                choices = by_writer[writer.name]
                if theme_number >= len(choices):
                    drafts[writer.name] = []
                    continue
                theme = choices[theme_number]
                common = {'theme_index': theme_number, 'theme': theme.title,
                          'source_url': theme.url, 'research': theme.raw_excerpt}
                contexts[writer.name] = (theme, common)
                drafts[writer.name] = [c.model_copy(update={"generation_route": "writer"}) for c in writer.run(theme)]
                self.record({**common, 'stage': 'draft', 'writer': writer.name,
                             'cards': [c.model_dump() for c in drafts[writer.name]]})
            for writer in writers:
                originals = drafts[writer.name]
                if not originals:
                    continue
                theme, common = contexts[writer.name]
                if len(writers) < 2:
                    final.extend(originals)
                    continue
                partner = PARTNERS.get(writer.name)
                challenger = by_name.get(partner) or writers[(writers.index(writer) + 1) % len(writers)]
                context = json.dumps({'theme': theme.title, 'angle': theme.angle,
                                      'cards': [c.model_dump() for c in originals]}, ensure_ascii=False)
                data = self.llm.complete_json(
                    system=(challenger.phase_system('critique', format_rules=FORMAT)
                            + ' For each draft return a critique and proposed card. ' + INJECTION_NOTICE
                            + ' Return {"challenges":[{"index":0,"critique":"short specific note",'
                            '"kind":"answer","text":"proposed card"}]}.'),
                    user=wrap_feed_data(context), temperature=0.8)
                challenges = []
                for idx, row in _indexed(data, 'challenges', len(originals)).items():
                    proposal = _suggestion(row, originals[idx], challenger.name)
                    critique = row.get('critique')
                    if proposal and isinstance(critique, str) and critique.strip():
                        challenges.append({'index': idx, 'critique': critique[:600],
                                           'kind': proposal.kind, 'text': proposal.text})
                self.record({**common, 'stage': 'challenge', 'writer': writer.name,
                             'challenger': challenger.name, 'challenges': challenges})
                revisions = {}
                if challenges:
                    data = self.llm.complete_json(
                        system=(writer.phase_system('revise', format_rules=FORMAT)
                                + ' Return only improved cards; omit indexes you want unchanged. ' + INJECTION_NOTICE
                                + ' Return {"revisions":[{"index":0,"kind":"answer","text":"revised card"}]}.'),
                        user=wrap_feed_data(json.dumps({'originals': json.loads(context), 'challenges': challenges}, ensure_ascii=False)),
                        temperature=0.8)
                    revisions = _indexed(data, 'revisions', len(originals))
                challenged = {row['index'] for row in challenges}
                for idx, original in enumerate(originals):
                    revised = (_suggestion(revisions[idx], original, writer.name)
                               if idx in revisions and idx in challenged else None)
                    chosen = revised or original
                    final.append(original)
                    if revised and revised.text != original.text:
                        revised.generation_route = "paired_revision"
                        final.append(revised)
                    self.record({**common, 'stage': 'revision', 'draft_id': f'{theme_number}:{writer.name}:{idx}',
                                 'writer': writer.name, 'challenger': challenger.name,
                                 'original': original.model_dump(),
                                 'revision': revised.model_dump() if revised else None,
                                 'final': chosen.model_dump(), 'changed': chosen.text != original.text})
        return final
