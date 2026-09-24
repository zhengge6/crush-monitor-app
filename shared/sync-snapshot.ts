import { topEmotions } from "./labels";
import { topIntents } from "./intents";
import type { LineResult } from "./types";

/** What the admin screen can paint without calling the model again. */
export type StoredLine = {
  id: string;
  skipped?: string;
  scoreValue?: number | null;
  emotions?: Record<string, number>;
  intents?: Record<string, number>;
};

function topMap(
  items: Array<{ key: string; probability: number }>,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.key] = Math.round(item.probability * 1000) / 1000;
  }
  return Object.keys(out).length ? out : undefined;
}

export function compactLine(line: LineResult): StoredLine {
  const scoreValue =
    typeof line.score?.value === "number" && Number.isFinite(line.score.value)
      ? line.score.value
      : null;
  return {
    id: String(line.id || "").slice(0, 80),
    skipped: line.skipped ? line.skipped.slice(0, 120) : undefined,
    scoreValue,
    emotions: topMap(topEmotions(line.emotions)),
    intents: topMap(topIntents(line.intents)),
  };
}

export function compactLines(
  lines: Record<string, LineResult> | undefined,
): StoredLine[] {
  if (!lines) return [];
  return Object.values(lines)
    .map(compactLine)
    .filter((line) => line.id)
    .slice(0, 5000);
}
