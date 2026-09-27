"""Shared generated-card length policy (see README for corpus measurement)."""
import re

from .text import finish_card_text

ANSWER_TARGET_CHARS = 54
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
    "Prompts: keep setups concise, with enough room for a playable premise. "
)
ANSWER_LENGTH_RULE = (
    "Answers: prefer 2 or 3 non-filler words; longer phrases are fine when needed. "
    f"Aim for {ANSWER_TARGET_CHARS} characters or fewer; this is a soft target, not a rejection limit. "
    f"Maximum {ANSWER_MAX_WORDS} non-filler words / {ANSWER_MAX_CHARS} total characters. "
    "Count whitespace-separated words, ignoring edge punctuation, case, and fillers: "
    + ", ".join(sorted(ANSWER_FILLER_WORDS)) + ". "
    "All text counts toward the character limit. "
)
LENGTH_RULES = PROMPT_LENGTH_RULE + ANSWER_LENGTH_RULE


def too_long(card):
    if card.kind == 'prompt':
        return False
    text = finish_card_text(card.text, kind=card.kind)
    return count_answer_words(text) > ANSWER_MAX_WORDS or len(text) > ANSWER_MAX_CHARS
