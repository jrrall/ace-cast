"""Card display cleanup and text normalisation for dedupe.

Dedupe normalisation must mirror the server's ``existingTextsForPack`` normalisation so the agent's
pre-flight trim and the server's authoritative dedupe agree on what "the same
card" means: lowercase, strip, collapse internal whitespace, drop punctuation.
The blank marker is preserved as a single token so prompts stay distinguishable.
"""

from __future__ import annotations

import re

_PUNCT = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")
_MARKER_TOKEN = " blank "


def normalize_text(text: str) -> str:
    s = text.lower().strip()
    s = s.replace("____", _MARKER_TOKEN)
    s = _PUNCT.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    return s


def finish_card_text(text: str, *, kind: str) -> str:
    """Polish presentation without rewriting the card's phrase or internal casing.

    A leading blank is already the start of a prompt; its following word stays
    lowercase. Prompts gain missing periods; answers lose ordinary final periods.
    Closing quotes/brackets stay outside the terminal punctuation.
    """
    text = _WS.sub(" ", text).strip()
    opening = re.match(r"[\"'“‘(\[]*([^\W\d_])", text)
    if opening:
        index = opening.start(1)
        text = text[:index] + text[index].upper() + text[index + 1:]
    body = text.rstrip("\"'”’)]}")
    closing = text[len(body):]
    if kind == "answer":
        if body.endswith(".") and not body.endswith(".."):
            text = body[:-1] + closing
    elif body and body[-1] not in ".!?…:":
        text = body + "." + closing
    return text
