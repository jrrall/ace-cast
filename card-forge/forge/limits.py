"""Shared generated-card length policy (see README for corpus measurement)."""

PROMPT_MAX_CHARS = 54
ANSWER_MAX_WORDS = 12
ANSWER_MAX_CHARS = 90
PROMPT_LENGTH_RULE = (
    f"Prompt text must be at most {PROMPT_MAX_CHARS} characters total, "
    "including spaces, punctuation, and all four characters of ____. "
)
LENGTH_RULES = (
    PROMPT_LENGTH_RULE
    + f"Answers: at most {ANSWER_MAX_WORDS} words and {ANSWER_MAX_CHARS} characters. "
)


def too_long(card):
    if card.kind == 'prompt':
        return len(card.text) > PROMPT_MAX_CHARS
    return len(card.text.split()) > ANSWER_MAX_WORDS or len(card.text) > ANSWER_MAX_CHARS
