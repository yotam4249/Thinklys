import { resolve } from "node:path";
import { INDEX_RELATIVE_PATH, readIndex } from "./runIndex.js";
import type { RunIndexEntry } from "./types.js";

const DEFAULT_LIMIT = 10;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return n;
}

function shortDate(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function shortId(uuid: string): string {
  return uuid.split("-")[0] ?? uuid.slice(0, 8);
}

function shortGit(entry: RunIndexEntry): string {
  if (entry.gitSha === null) return "no-git";
  return entry.gitSha.slice(0, 7) + (entry.gitDirty ? "*" : "");
}

function clip(value: string, width: number): string {
  if (value.length <= width) return value;
  return "…" + value.slice(value.length - (width - 1));
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv[2]);
  const indexPath = resolve(process.cwd(), INDEX_RELATIVE_PATH);
  const entries = await readIndex(indexPath);

  if (entries.length === 0) {
    console.error(`[eval:list] no runs found at ${indexPath}`);
    console.error(`[eval:list] run \`npm run eval\` first.`);
    return;
  }

  const sorted = [...entries].sort((a, b) =>
    b.finishedAt.localeCompare(a.finishedAt),
  );
  const recent = sorted.slice(0, limit);

  const cols: Array<{ title: string; width: number; get: (e: RunIndexEntry) => string }> = [
    { title: "finished (UTC)", width: 19, get: (e) => shortDate(e.finishedAt) },
    { title: "runId", width: 8, get: (e) => shortId(e.runId) },
    { title: "git", width: 8, get: (e) => shortGit(e) },
    { title: "dataset", width: 24, get: (e) => clip(e.datasetPath, 24) },
    { title: "cases", width: 5, get: (e) => String(e.caseCount) },
    { title: "errs", width: 4, get: (e) => String(e.errors) },
    { title: "base corr", width: 9, get: (e) => fmtPct(e.baseline.correctnessPct) },
    { title: "agent corr", width: 10, get: (e) => fmtPct(e.agent.correctnessPct) },
    { title: "base grnd", width: 9, get: (e) => fmtPct(e.baseline.groundednessPct) },
    { title: "agent grnd", width: 10, get: (e) => fmtPct(e.agent.groundednessPct) },
    { title: "base $", width: 9, get: (e) => fmtUsd(e.baseline.totalCostUsd) },
    { title: "agent $", width: 9, get: (e) => fmtUsd(e.agent.totalCostUsd) },
  ];

  const header = "| " + cols.map((c) => c.title.padEnd(c.width)).join(" | ") + " |";
  const sep = "| " + cols.map((c) => "-".repeat(c.width)).join(" | ") + " |";

  console.log(`Recent eval runs (showing ${recent.length} of ${entries.length}):\n`);
  console.log(header);
  console.log(sep);
  for (const e of recent) {
    const row = cols.map((c) => clip(c.get(e), c.width).padEnd(c.width));
    console.log("| " + row.join(" | ") + " |");
  }
  console.log(
    `\nFull results in eval/results/<runId-or-date>.json — use \`npm run trace -- <file>\` to inspect.`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`eval:list failed: ${message}`);
  process.exit(1);
});
