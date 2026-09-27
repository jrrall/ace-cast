"""Shared generated-card length policy (see README for corpus measurement)."""

PROMPT_MAX_CHARS = 54
ANSWER_MAX_WORDS = 5
ANSWER_MAX_CHARS = 90
PROMPT_LENGTH_RULE = (
    f"Prompt text must be at most {PROMPT_MAX_CHARS} characters total, "
    "including spaces, punctuation, and all four characters of ____. "
)
ANSWER_LENGTH_RULE = (
    f"Answers: prefer 2 or 3 words, allowing up to {ANSWER_MAX_WORDS} words "
    f"and {ANSWER_MAX_CHARS} characters. One word is fine. "
    "Keep names and specific comic details when they need four or five words. "
    "Count words separated by whitespace, including articles. "
)
LENGTH_RULES = PROMPT_LENGTH_RULE + ANSWER_LENGTH_RULE


def too_long(card):
    if card.kind == 'prompt':
        return len(card.text) > PROMPT_MAX_CHARS
    return len(card.text.split()) > ANSWER_MAX_WORDS or len(card.text) > ANSWER_MAX_CHARS
