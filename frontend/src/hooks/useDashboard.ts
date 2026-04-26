/**
 * TanStack Query hook wrapping `fetchDashboard`.
 *
 * Phase 5 of `ui_schema_design.md`.
 *
 * Usage:
 *   const { data, isLoading, error } = useDashboard(matchId);
 *   // data is DashboardPayload | undefined
 */
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "@/lib/api/client";
import type { DashboardPayload } from "@/lib/api/types";

export interface UseDashboardOptions {
  /** Serve from demo cache instead of running the live pipeline. */
  demo?: boolean;
  /** Which side is the opponent (default "away"). */
  opponentSide?: "home" | "away";
  /** If false, the query won't run (e.g. until the user clicks Start). */
  enabled?: boolean;
}

/**
 * Fetch a DashboardPayload for `matchId`.
 *
 * The query key includes the matchId and demo flag so switching between
 * live/demo mode triggers a refetch automatically.
 *
 * `staleTime` is set to Infinity — the pipeline is expensive and the data
 * doesn't change between renders. Refetch explicitly with `refetch()`.
 */
export function useDashboard(
  matchId: number | null,
  options?: UseDashboardOptions,
) {
  const { demo = false, opponentSide = "away", enabled = true } = options ?? {};

  return useQuery<DashboardPayload>({
    queryKey: ["dashboard", matchId, demo, opponentSide],
    queryFn: ({ signal }) =>
      fetchDashboard(matchId!, { demo, opponentSide, signal }),
    enabled: enabled && matchId !== null,
    staleTime: Infinity,
    retry: false, // Pipeline failures are usually not transient
  });
}
