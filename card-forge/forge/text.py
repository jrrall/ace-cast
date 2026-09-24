"""Text normalisation for dedupe.

Must mirror the server's ``existingTextsForPack`` normalisation so the agent's
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
