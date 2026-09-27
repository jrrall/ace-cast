"""Shared generated-card length policy (see README for corpus measurement)."""
import re

PROMPT_MAX_CHARS = 54
# Compact answer cap; filler words do not count.
ANSWER_MAX_WORDS = 8
ANSWER_MAX_CHARS = 90
ANSWER_FILLER_WORDS = frozenset(
    "a an the and or but of to in on at by for with from as".split()
)


def count_answer_words(text):
    """Count whitespace-separated tokens, excluding fixed, case-insensitive fillers.

    Edge punctuation is ignored for matching; internal apostrophes and hyphens
    stay intact. Negations and pronouns are meaningful and still count.
    """
    tokens = (re.sub(r"^\W+|\W+$", "", token).casefold() for token in text.split())
    return sum(bool(token) and token not in ANSWER_FILLER_WORDS for token in tokens)


PROMPT_LENGTH_RULE = (
    f"Prompt text must be at most {PROMPT_MAX_CHARS} characters total, "
    "including spaces, punctuation, and all four characters of ____. "
)
ANSWER_LENGTH_RULE = (
    "Answers: prefer 2 or 3 non-filler words; longer phrases are fine when needed. "
    f"Maximum {ANSWER_MAX_WORDS} non-filler words / {ANSWER_MAX_CHARS} total characters. "
    "Count whitespace-separated words, ignoring edge punctuation, case, and fillers: "
    + ", ".join(sorted(ANSWER_FILLER_WORDS)) + ". "
    "All text counts toward the character limit. "
)
LENGTH_RULES = PROMPT_LENGTH_RULE + ANSWER_LENGTH_RULE


def too_long(card):
    if card.kind == 'prompt':
        return len(card.text) > PROMPT_MAX_CHARS
    return count_answer_words(card.text) > ANSWER_MAX_WORDS or len(card.text) > ANSWER_MAX_CHARS
