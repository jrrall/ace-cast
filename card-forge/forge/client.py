"""Content API client for ace-cast.

The API is the ONLY contract between Card Forge and the game. The agent never
touches the game's database, files, or internal modules — only these HTTP calls
authenticated with ``Authorization: Bearer $CONTENT_API_TOKEN``.
"""

from __future__ import annotations

import httpx

from .config import Settings
from .models import SubmitBatch, SubmitResult


class ContentAPIError(RuntimeError):
    """Raised on any non-success response or transport failure."""


class ContentClient:
    def __init__(self, settings: Settings, http: httpx.Client | None = None) -> None:
        self.settings = settings
        self.base_url = settings.content_api_url.rstrip("/")
        self._http = http or httpx.Client(
            timeout=settings.content_api_timeout,
            headers={"Authorization": f"Bearer {settings.content_api_token}"},
        )

    def list_cards(
        self,
        *,
        status: str | None = None,
        kind: str | None = None,
        limit: int = 1000,
    ) -> list[dict]:
        """GET the existing corpus for dedupe.

        Omitting ``status`` returns cards of ALL statuses (including ``denied``)
        so the Curator can pre-trim against denied text — matching the server's
        authoritative dedupe which also includes denied.
        """
        params: dict[str, object] = {"limit": limit}
        if status is not None:
            params["status"] = status
        if kind is not None:
            params["kind"] = kind
        try:
            resp = self._http.get(f"{self.base_url}/api/content/cards", params=params)
        except httpx.HTTPError as exc:
            raise ContentAPIError(f"GET /api/content/cards failed: {exc}") from exc
        if resp.status_code != 200:
            raise ContentAPIError(
                f"GET /api/content/cards -> {resp.status_code}: {resp.text[:200]}"
            )
        body = resp.json()
        return body.get("cards", [])

    def submit(self, batch: SubmitBatch) -> SubmitResult:
        """POST the assembled batch.

        Idempotent by construction: the server dedupes on ``(pack_id, text)``
        across all statuses, so a retried run does not double-submit — already
        present cards come back in ``skipped`` rather than being duplicated.
        """
        try:
            resp = self._http.post(
                f"{self.base_url}/api/content/cards", json=batch.payload()
            )
        except httpx.HTTPError as exc:
            raise ContentAPIError(f"POST /api/content/cards failed: {exc}") from exc
        if resp.status_code not in (200, 201):
            raise ContentAPIError(
                f"POST /api/content/cards -> {resp.status_code}: {resp.text[:200]}"
            )
        return SubmitResult.model_validate(resp.json())
