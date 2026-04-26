/**
 * API client — fetches DashboardPayload from the FastAPI backend.
 *
 * Phase 5 of `ui_schema_design.md`.
 *
 * Reads `VITE_API_BASE_URL` from the Vite env (default http://localhost:8000).
 * Append `?demo=1` for cached demo payloads that skip all LLM calls.
 */
import type { DashboardPayload } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

/**
 * Fetch a full dashboard payload for a given match.
 *
 * @param matchId   Supabase match ID.
 * @param options   Optional: `demo` (use cached payload), `opponentSide`.
 */
export async function fetchDashboard(
  matchId: number,
  options?: {
    demo?: boolean;
    opponentSide?: "home" | "away";
    signal?: AbortSignal;
  },
): Promise<DashboardPayload> {
  const params = new URLSearchParams();
  if (options?.demo) params.set("demo", "1");
  if (options?.opponentSide) params.set("opponent_side", options.opponentSide);

  const qs = params.toString();
  const url = `${API_BASE}/api/analysis/${matchId}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    signal: options?.signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Unknown API error");
  }

  return (await res.json()) as DashboardPayload;
}

/**
 * Lightweight health check.
 */
export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new ApiError(res.status, "Health check failed");
  return res.json();
}

/**
 * Typed error for API failures.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
