"""Per-call output budgets and diagnostic context, separate from prompt text."""
from contextvars import ContextVar

CALL_CONTEXT = ContextVar('forge_call_context', default={})
# Base JSON overhead plus an allowance per requested output item.
TOKENS_PER_ITEM = {'scout': 256, 'write': 160, 'answer': 160, 'critique': 320,
                   'revise': 160, 'editor': 192, 'moderator': 128, 'curator': 256,
                   'group_repair': 64, 'tighten': 192, 'source_find': 16}


def complete(llm, phase, *, units=1, persona=None, batch=None, **request):
    context = {'phase': phase, 'max_tokens': min(16384, 256 + max(1, units) * TOKENS_PER_ITEM[phase])}
    if persona is not None:
        context['persona'] = persona
    if batch is not None:
        context['batch'] = batch
    token = CALL_CONTEXT.set(context)
    try:
        return llm.complete_json(**request)
    finally:
        CALL_CONTEXT.reset(token)
