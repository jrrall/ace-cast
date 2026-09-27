"""Shared generated-card length policy (see README for corpus measurement)."""

PROMPT_MAX_CHARS = 54
ANSWER_MAX_WORDS = 3
ANSWER_MAX_CHARS = 90
PROMPT_LENGTH_RULE = (
    f"Prompt text must be at most {PROMPT_MAX_CHARS} characters total, "
    "including spaces, punctuation, and all four characters of ____. "
)
ANSWER_LENGTH_RULE = (
    f"Answers: aim for 2 or 3 words; at most {ANSWER_MAX_WORDS} words "
    f"and {ANSWER_MAX_CHARS} characters. One word is fine. "
    "Count words separated by whitespace, including articles. "
)
LENGTH_RULES = PROMPT_LENGTH_RULE + ANSWER_LENGTH_RULE


def too_long(card):
    if card.kind == 'prompt':
        return len(card.text) > PROMPT_MAX_CHARS
    return len(card.text.split()) > ANSWER_MAX_WORDS or len(card.text) > ANSWER_MAX_CHARS
