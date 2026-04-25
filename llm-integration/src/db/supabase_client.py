"""Thin httpx wrapper over Supabase's PostgREST API.

We use REST (not the supabase-py SDK) so the dependency footprint stays small —
`httpx` is the only new requirement. Auth is the service-role key passed via
`SUPABASE_SERVICE_ROLE_KEY`, matching the cloud function's env-var naming.

Each `fetch_*` function returns plain dicts (raw row shape from Postgres).
Schema-typing the rows is the bundle layer's job (`bundle.py`).
"""
from __future__ import annotations

import os
from typing import Any

import httpx


class SupabaseConfigError(RuntimeError):
    """Raised when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing."""


class SupabaseClient:
    """Reusable connection wrapper. Holds an `httpx.Client` so connections are
    pooled across the five `fetch_*` calls a single pipeline run makes.

    Two sources for credentials, in order:
      1. Constructor args (test-only).
      2. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars.
    """

    DEFAULT_TIMEOUT = 30.0

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        client: httpx.Client | None = None,
    ) -> None:
        url = url or os.environ.get("SUPABASE_URL")
        api_key = api_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not api_key:
            raise SupabaseConfigError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
                "(env vars or constructor args)."
            )
        self._base_url = url.rstrip("/") + "/rest/v1"
        self._headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=timeout)

    # ---------------------- low-level ----------------------

    def _get(self, table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        url = f"{self._base_url}/{table}"
        response = self._client.get(url, headers=self._headers, params=params)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            raise RuntimeError(
                f"Unexpected non-list response from Supabase /{table}: {type(data).__name__}"
            )
        return data

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "SupabaseClient":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # ---------------------- high-level fetchers ----------------------

    def fetch_match(self, match_id: int) -> dict[str, Any] | None:
        rows = self._get("matches", {"id": f"eq.{match_id}", "limit": "1"})
        return rows[0] if rows else None

    def fetch_players(self, match_id: int) -> list[dict[str, Any]]:
        return self._get("players", {"match_id": f"eq.{match_id}"})

    def fetch_passes(self, match_id: int) -> list[dict[str, Any]]:
        # PostgREST has no hard cap on `limit`, but Supabase enforces 1000 by default.
        # A full match easily exceeds 1000 passes — page through it.
        return self._paginate("passes", {"match_id": f"eq.{match_id}", "order": "created_at.asc"})

    def fetch_match_events(self, match_id: int) -> list[dict[str, Any]]:
        return self._paginate(
            "match_events",
            {"match_id": f"eq.{match_id}", "order": "timestamp.asc"},
        )

    def fetch_spatial_analysis(self, match_id: int) -> list[dict[str, Any]]:
        """Returns both PLAYER and TEAM rows; caller filters by `type`."""
        return self._get("spatial_analysis", {"match_id": f"eq.{match_id}"})

    # ---------------------- pagination helper ----------------------

    def _paginate(
        self,
        table: str,
        base_params: dict[str, Any],
        *,
        page_size: int = 1000,
        max_rows: int = 50_000,
    ) -> list[dict[str, Any]]:
        all_rows: list[dict[str, Any]] = []
        offset = 0
        while offset < max_rows:
            params = dict(base_params)
            params["limit"] = str(page_size)
            params["offset"] = str(offset)
            page = self._get(table, params)
            all_rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        return all_rows


# ---------------------- module-level convenience ----------------------

_default_client: SupabaseClient | None = None


def get_default_client() -> SupabaseClient:
    """Lazily-built process-wide client. Tests should construct their own."""
    global _default_client
    if _default_client is None:
        _default_client = SupabaseClient()
    return _default_client


def fetch_match(match_id: int, *, client: SupabaseClient | None = None) -> dict[str, Any] | None:
    return (client or get_default_client()).fetch_match(match_id)


def fetch_players(match_id: int, *, client: SupabaseClient | None = None) -> list[dict[str, Any]]:
    return (client or get_default_client()).fetch_players(match_id)


def fetch_passes(match_id: int, *, client: SupabaseClient | None = None) -> list[dict[str, Any]]:
    return (client or get_default_client()).fetch_passes(match_id)


def fetch_match_events(match_id: int, *, client: SupabaseClient | None = None) -> list[dict[str, Any]]:
    return (client or get_default_client()).fetch_match_events(match_id)


def fetch_spatial_analysis(
    match_id: int, *, client: SupabaseClient | None = None
) -> list[dict[str, Any]]:
    return (client or get_default_client()).fetch_spatial_analysis(match_id)
