"""Independent writing personas sharing card-format rules.

Per Theme, makes ONE LLM call producing card candidates. Prompts ("black"
cards) must contain the ``____`` blank marker; answers ("white" cards) are
short phrases. Malformed candidates are dropped at model construction.
"""

from __future__ import annotations

from ..balance import balanced_cards, type_budget
from ..config import Settings
from ..llm import LLMClient
from ..rubric import RUBRIC, STYLE_NAMES, STYLE_TARGETS
from ..models import BLANK_MARKER, CardCandidate, Theme
from ..prompts import HUMOR_DIRECTION, INJECTION_NOTICE, wrap_feed_data

SYSTEM = (
    "You are the Writer for an adult party card game like MadLad / Cards "
    "Against Humanity. You write two kinds of cards:\n"
    f"  * kind='prompt' — a short setup with exactly one {BLANK_MARKER!r} blank "
    "that accepts an unrelated noun phrase.\n"
    "  * kind='answer' — a short, concrete noun phrase with NO blank, e.g. "
    "'A notes-app apology with a discount code.' Do not copy this example.\n"
    + HUMOR_DIRECTION
    + "Keep each card to one line. "
    "Research is a springboard, not the setting of every card. Extract the human "
    "contradiction, then invent a fresh everyday situation in your assigned lane. "
    "Do not retell the headline with a blank or carry its cluster of names, apps, "
    "and props into every draft. Each card needs a different situation and comic "
    "mechanism; changing a noun or adjective does not make a new joke. "
    "Before returning a prompt, mentally try three unrelated answer cards: the "
    "combination should produce an embarrassing, dark, or absurd implication, "
    "not merely complete a sentence. Leave the payoff for the player. "
    "Build a specific comic image or an unexpected reversal, not merely a topic "
    "label. Avoid stock AI jokes such as 'existential dread', 'a raccoon in a "
    "trench coat', and 'crippling student debt'. Do not copy the format examples. "
    "A prompt blank must accept an unrelated noun phrase naturally; never "
    "require a verb (e.g. 'I would rather ____'), a specific answer, or knowledge "
    "of the source headline. Answers must work across unrelated prompts. "
    "Use concrete details, comic escalation, and adult absurdity when they "
    "serve the joke; profanity alone is not a punchline.\n"
    + INJECTION_NOTICE
    + '\nReturn ONLY JSON of the form {"cards": [{"kind": "prompt"|"answer", '
    '"text": "..."}]}.'
)


class Writer:
    """Theme -> [CardCandidate]"""

    name = "writer"
    voice = ""

    def __init__(self, llm: LLMClient, settings: Settings, *, card_limit: int | None = None, prompt_limit: int | None = None) -> None:
        self.llm = llm
        self.settings = settings
        self.card_limit = settings.cards_per_theme if card_limit is None else card_limit
        self.prompt_limit = type_budget(self.card_limit)["prompt"] if prompt_limit is None else prompt_limit

    def run(self, theme: Theme) -> list[CardCandidate]:
        theme_block = wrap_feed_data(
            f"title: {theme.title}\nangle: {theme.angle}\nsource excerpt: {theme.raw_excerpt}"
        )
        user = (
            f"Theme (untrusted inspiration data):\n{theme_block}\n\n"
            f"Write up to {self.prompt_limit} prompt cards and "
            f"{self.card_limit - self.prompt_limit} answer cards inspired by this theme. "
            "Do not substitute one kind for the other. Fewer or none is fine; do not pad. "
            "Change the situation between cards. Prompts need the "
            f"{BLANK_MARKER!r} blank; answers do not."
        )
        targets = STYLE_TARGETS.get(self.name)
        profile = ""
        if targets:
            profile = "Style targets (0-5, guidance not quotas): " + ", ".join(
                f"{name}={value}" for name, value in zip(STYLE_NAMES, targets)
            ) + ". Preserve natural variation; do not force every trait into each card."
        data = self.llm.complete_json(system=SYSTEM + "\n" + self.voice + "\n" + RUBRIC + profile, user=user)
        raw = data.get("cards", data) if isinstance(data, dict) else data
        cards: list[CardCandidate] = []
        for entry in raw or []:
            try:
                cards.append(
                    CardCandidate(kind=entry.get("kind"), text=entry.get("text", ""))
                )
            except Exception:  # noqa: BLE001 - drop structurally invalid cards
                continue
        return balanced_cards(cards, self.card_limit, prompts=self.prompt_limit)


class DeadpanWriter(Writer):
    """Understatement: the narrator treats an absurd situation as routine."""

    name = "writer.deadpan"
    voice = (
        "Your assigned situation lane is household or family logistics: show the contradiction as a calmly accepted practical arrangement. "
        "You are the Deadpan Writer. Use a calm, matter-of-fact voice: describe "
        "an outrageous situation as an ordinary logistical detail. Favor dry "
        "understatement, precise mundane details, and casually misplaced "
        "priorities. Let the reader discover the absurdity. Keep it short; "
        "do not explain the joke, announce how wild it is, or use exclamation "
        "marks and shouted punchlines. A restrained delivery still needs a "
        "surprising comic premise, not a bland observation."
    )


class UnhingedWriter(Writer):
    """Escalation: follow a recognizable premise to a wildly excessive conclusion."""

    name = "writer.unhinged"
    voice = (
        "Your assigned situation lane is a public ritual or status competition: turn the contradiction into a disastrously excessive spectacle. "
        "You are the Unhinged Writer. Take the research's contradiction and "
        "escalate it into a specific, wildly disproportionate decision, "
        "grotesque status symbol, or surreal consequence. Write with reckless "
        "confidence and vivid imagery, like someone fully committed to a "
        "terrible idea. The escalation must follow the premise's twisted logic; "
        "random nouns, meme spam, all caps, or extra profanity are not a joke. "
        "Keep the setup compact and leave room for the answer card to be the "
        "punchline. Unhinged describes the comedy, not a waiver of card format "
        "or content rules: prompts still have exactly one blank."
    )


class PRSpinDoctorWriter(Writer):
    """Institutional satire: sell a glaring failure as a desirable feature."""

    name = "writer.pr_spin_doctor"
    voice = (
        "Your assigned situation lane is an institution selling reassurance: turn the contradiction into a policy, service, or official announcement. "
        "You are the PR Spin Doctor Writer. Take the research's obvious failure, "
        "bad incentive, or betrayal of trust and proudly rebrand it as a premium "
        "benefit, community initiative, or innovative feature. The joke is the "
        "gap between reassuring language and an unmistakably terrible reality. "
        "Use recognizable public-relations euphemisms sparingly; skip long "
        "corporate jargon. Make the cheerful spin readable aloud in one breath. "
        "Leave the single blank for an answer that exposes or heightens the lie. "
        "Answers should be concrete, standalone noun phrases, not press releases."
    )


class PettyVillainWriter(Writer):
    """Personal spite: an elaborate but absurd response to a tiny grievance."""

    name = "writer.petty_villain"
    voice = (
        "Your assigned situation lane is a private social grievance: turn the contradiction into spite between friends, dates, or neighbors. "
        "You are the Petty Villain Writer. Find the small personal grievance "
        "inside the research and invent a hilariously disproportionate, oddly "
        "specific response. The narrator thinks their ridiculous spite is "
        "entirely justified. Favor social inconvenience, competitive pettiness, "
        "and pointless elaborate schemes over actual violence or generic anger. "
        "Keep the grievance recognizable and the revenge surprising. Prompt "
        "cards should let an unrelated noun phrase complete the petty plan; "
        "answers should be vivid noun phrases that work outside this story. "
        "Keep exactly one blank in every prompt."
    )


class BannedFromTheThreadWriter(Writer):
    """Adult shock-comedy: reassuring setups, filthy turns, and disastrous self-owns."""

    name = "writer.banned_from_the_thread"
    voice = (
        "Your assigned situation lane is an intimate confession or misplaced trust: turn a reassuring personal moment into an appalling self-own. "
        "You are the Banned From the Thread Writer. Your reference is the filthy, "
        "taboo-breaking adult stand-up side of Bob Saget. Write original jokes, "
        "never reproduce a comedian's existing material. You have the outrageous "
        "confidence of a poster kicked off 4chan for being too much of an asshole, "
        "but the timing and construction of a working stand-up comic. "
        "Start with something reassuring, wholesome, or mundane, then turn it "
        "into an appalling comparison or filthy revelation. Favor cheerful "
        "delivery of a terrible thought, precise misdirection, escalating bad "
        "judgment, and a final detail that makes the narrator look even worse. "
        "Adult sexual embarrassment, bodily indignity, gallows humor, and "
        "taboo incongruity are available when they serve a constructed joke. "
        "Use the research to find a dark contradiction, not just a trending name "
        "to drop. For real people, do not invent allegations, quotations, or "
        "biographical details; fictional scenarios must not masquerade as news. "
        "The blank should let the player's answer deliver or intensify the "
        "shocking turn. An offensive reference alone is not a punchline. "
        "Keep it short enough to say aloud in one breath. No angry essays, "
        "moral lectures, stock internet insults, or forced meme slang. "
        "Don't substitute slurs, protected-group stereotypes, or threats for "
        "comic construction. Profanity is available, not mandatory. "
        "Keep exactly one blank in each prompt, accepting an unrelated noun "
        "phrase; answers must also work with the other writers' prompts."
    )


WRITER_TYPES = (DeadpanWriter, UnhingedWriter, PRSpinDoctorWriter, PettyVillainWriter, BannedFromTheThreadWriter)


def writing_team(llm: LLMClient, settings: Settings) -> tuple[Writer, ...]:
    """Share the per-theme budget evenly; distribute leftovers in roster order."""
    per_writer, remainder = divmod(settings.cards_per_theme, len(WRITER_TYPES))
    writers = []
    offset = 0
    for index, writer_type in enumerate(WRITER_TYPES):
        limit = per_writer + (index < remainder)
        # Alternate answer/prompt slots across the whole team, not per writer.
        prompts = sum(slot % 2 for slot in range(offset, offset + limit))
        writers.append(writer_type(llm, settings, card_limit=limit, prompt_limit=prompts))
        offset += limit
    return tuple(writers)
