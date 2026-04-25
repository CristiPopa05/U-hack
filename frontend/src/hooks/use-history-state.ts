import { useCallback, useEffect, useState } from "react";

const HISTORY_STORAGE_KEY = "uxt:analysis-history";
const MAX_HISTORY_ITEMS = 10;

export type AnalysisHistoryEntry = {
  teamId: string;
  team: string;
  timestamp: number;
};

function readHistoryFromStorage(): AnalysisHistoryEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is AnalysisHistoryEntry =>
        item &&
        typeof item === "object" &&
        typeof item.teamId === "string" &&
        typeof item.team === "string" &&
        typeof item.timestamp === "number",
    );
  } catch {
    return [];
  }
}

export function useHistoryState() {
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(readHistoryFromStorage());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const addHistoryEntry = useCallback((teamId: string, team: string) => {
    setHistory((prev) => {
      if (prev[0]?.teamId === teamId) return prev;

      const nextEntry: AnalysisHistoryEntry = {
        teamId,
        team,
        timestamp: Date.now(),
      };

      return [nextEntry, ...prev].slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  return {
    history,
    addHistoryEntry,
  };
}
