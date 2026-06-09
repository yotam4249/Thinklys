import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { INDEX_RELATIVE_PATH, readIndex } from "./runIndex.js";
import type {
  EvalRunResult,
  Judgement,
  RunIndexEntry,
  SystemAggregate,
  SystemName,
} from "./types.js";

const SYSTEMS: ReadonlyArray<SystemName> = ["baseline", "agent"];

interface PickedPair {
  base: RunIndexEntry;
  head: RunIndexEntry;
}

interface CaseTransition {
  caseId: string;
  baseCorrect: boolean | null;
  headCorrect: boolean | null;
  baseGrounded: boolean | null;
  headGrounded: boolean | null;
}

function usage(): never {
  console.error(
    "usage: npm run eval:compare [-- <runIdA> <runIdB>]\n" +
      "  no args  : compare the two most recent runs with the same datasetHash\n" +
      "  two args : compare those runs (8-char prefix OK); older is base, newer is head",
  );
  process.exit(2);
}

function findByPrefix(entries: ReadonlyArray<RunIndexEntry>, prefix: string): RunIndexEntry {
  const matches = entries.filter((e) => e.runId.startsWith(prefix));
  if (matches.length === 0) throw new Error(`no run matching "${prefix}"`);
  if (matches.length > 1) {
    const ids = matches.map((m) => m.runId).join(", ");
    throw new Error(`prefix "${prefix}" is ambiguous (${matches.length} matches: ${ids})`);
  }
  // matches.length === 1 — assertion for noUncheckedIndexedAccess
  const hit = matches[0];
  if (hit === undefined) throw new Error("unreachable");
  return hit;
}

function pickPair(entries: ReadonlyArray<RunIndexEntry>, args: ReadonlyArray<string>): PickedPair {
  const sorted = [...entries].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  if (args.length === 0) {
    const latest = sorted[0];
    if (latest === undefined) throw new Error("no runs in index");
    const prev = sorted.slice(1).find((e) => e.datasetHash === latest.datasetHash);
    if (prev === undefined) {
      throw new Error(
        `no prior run with datasetHash=${latest.datasetHash}; pass explicit runIds to override`,
      );
    }
    return { base: prev, head: latest };
  }

  if (args.length !== 2) usage();
  const a = findByPrefix(sorted, args[0] ?? "");
  const b = findByPrefix(sorted, args[1] ?? "");
  if (a.runId === b.runId) {
    throw new Error("both runIds resolve to the same run");
  }
  return a.finishedAt < b.finishedAt ? { base: a, head: b } : { base: b, head: a };
}

async function loadResult(resultsFileRel: string): Promise<EvalRunResult> {
  const fullPath = resolve(process.cwd(), resultsFileRel);
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw) as EvalRunResult;
}

function fmtDeltaPct(base: number, head: number): string {
  const delta = head - base;
  const sign = delta >= 0 ? "+" : "";
  return `${base.toFixed(1)}% → ${head.toFixed(1)}% (${sign}${delta.toFixed(1)})`;
}

function fmtOptionalDeltaPct(
  base: number | undefined,
  head: number | undefined,
): string {
  if (base === undefined && head === undefined) return "n/a (no cases)";
  if (base === undefined) return `- → ${head?.toFixed(1)}% (new)`;
  if (head === undefined) return `${base.toFixed(1)}% → - (gone)`;
  return fmtDeltaPct(base, head);
}

function fmtDeltaNum(base: number, head: number, digits = 0): string {
  const delta = head - base;
  const sign = delta >= 0 ? "+" : "";
  return `${base.toFixed(digits)} → ${head.toFixed(digits)} (${sign}${delta.toFixed(digits)})`;
}

function fmtDeltaUsd(base: number, head: number): string {
  const delta = head - base;
  const sign = delta >= 0 ? "+" : "";
  return `$${base.toFixed(4)} → $${head.toFixed(4)} (${sign}$${Math.abs(delta).toFixed(4)})`;
}

function renderAggregateTable(
  base: { baseline: SystemAggregate; agent: SystemAggregate },
  head: { baseline: SystemAggregate; agent: SystemAggregate },
): string {
  const rows: Array<[string, string, string]> = [
    [
      "Correctness %",
      fmtDeltaPct(base.baseline.correctnessPct, head.baseline.correctnessPct),
      fmtDeltaPct(base.agent.correctnessPct, head.agent.correctnessPct),
    ],
    [
      "Groundedness %",
      fmtDeltaPct(base.baseline.groundednessPct, head.baseline.groundednessPct),
      fmtDeltaPct(base.agent.groundednessPct, head.agent.groundednessPct),
    ],
    [
      "Adversarial pass-rate",
      fmtOptionalDeltaPct(base.baseline.adversarialPct, head.baseline.adversarialPct),
      fmtOptionalDeltaPct(base.agent.adversarialPct, head.agent.adversarialPct),
    ],
    [
      "Mean tool calls / Q",
      fmtDeltaNum(base.baseline.meanToolCalls, head.baseline.meanToolCalls, 2),
      fmtDeltaNum(base.agent.meanToolCalls, head.agent.meanToolCalls, 2),
    ],
    [
      "Mean input tokens / Q",
      fmtDeltaNum(base.baseline.meanInputTokens, head.baseline.meanInputTokens, 0),
      fmtDeltaNum(base.agent.meanInputTokens, head.agent.meanInputTokens, 0),
    ],
    [
      "Mean cache-read tokens",
      fmtDeltaNum(base.baseline.meanCacheReadTokens, head.baseline.meanCacheReadTokens, 0),
      fmtDeltaNum(base.agent.meanCacheReadTokens, head.agent.meanCacheReadTokens, 0),
    ],
    [
      "Mean output tokens / Q",
      fmtDeltaNum(base.baseline.meanOutputTokens, head.baseline.meanOutputTokens, 0),
      fmtDeltaNum(base.agent.meanOutputTokens, head.agent.meanOutputTokens, 0),
    ],
    [
      "Mean latency (ms)",
      fmtDeltaNum(base.baseline.meanLatencyMs, head.baseline.meanLatencyMs, 0),
      fmtDeltaNum(base.agent.meanLatencyMs, head.agent.meanLatencyMs, 0),
    ],
    [
      "Total cost (USD)",
      fmtDeltaUsd(base.baseline.totalCostUsd, head.baseline.totalCostUsd),
      fmtDeltaUsd(base.agent.totalCostUsd, head.agent.totalCostUsd),
    ],
  ];

  const metricCol = Math.max(...rows.map((r) => r[0].length), "Metric".length);
  const baselineCol = Math.max(...rows.map((r) => r[1].length), "Baseline (base → head)".length);
  const agentCol = Math.max(...rows.map((r) => r[2].length), "Agent (base → head)".length);

  const header =
    `| ${"Metric".padEnd(metricCol)} | ${"Baseline (base → head)".padEnd(baselineCol)} | ${"Agent (base → head)".padEnd(agentCol)} |`;
  const sep = `| ${"-".repeat(metricCol)} | ${"-".repeat(baselineCol)} | ${"-".repeat(agentCol)} |`;
  const body = rows.map(
    ([m, b, a]) => `| ${m.padEnd(metricCol)} | ${b.padEnd(baselineCol)} | ${a.padEnd(agentCol)} |`,
  );
  return [header, sep, ...body].join("\n");
}

function indexJudgements(
  judgements: ReadonlyArray<Judgement>,
  system: SystemName,
): Map<string, Judgement> {
  const out = new Map<string, Judgement>();
  for (const j of judgements) {
    if (j.system === system) out.set(j.caseId, j);
  }
  return out;
}

function buildTransitions(
  base: EvalRunResult,
  head: EvalRunResult,
  system: SystemName,
): CaseTransition[] {
  const baseIdx = indexJudgements(base.judgements, system);
  const headIdx = indexJudgements(head.judgements, system);
  const ids = new Set<string>();
  for (const c of base.cases) ids.add(c.id);
  for (const c of head.cases) ids.add(c.id);
  const sortedIds = [...ids].sort();
  const out: CaseTransition[] = [];
  for (const id of sortedIds) {
    const b = baseIdx.get(id);
    const h = headIdx.get(id);
    out.push({
      caseId: id,
      baseCorrect: b ? b.correct : null,
      headCorrect: h ? h.correct : null,
      baseGrounded: b ? b.grounded : null,
      headGrounded: h ? h.grounded : null,
    });
  }
  return out;
}

function fmtBool(value: boolean | null): string {
  if (value === null) return "-";
  return value ? "yes" : "no";
}

function summariseTransition(t: CaseTransition): string {
  const notes: string[] = [];
  if (t.baseCorrect !== null && t.headCorrect !== null && t.baseCorrect !== t.headCorrect) {
    notes.push(t.headCorrect ? "correct: fail→pass" : "correct: pass→fail (regression)");
  }
  if (t.baseGrounded !== null && t.headGrounded !== null && t.baseGrounded !== t.headGrounded) {
    notes.push(
      t.headGrounded ? "grounded: fail→pass" : "grounded: pass→fail (regression)",
    );
  }
  if (t.baseCorrect === null) notes.push("absent in base");
  if (t.headCorrect === null) notes.push("absent in head");
  if (notes.length === 0) return "-";
  return notes.join("; ");
}

function renderTransitions(transitions: ReadonlyArray<CaseTransition>): string {
  const idCol = Math.max(...transitions.map((t) => t.caseId.length), "caseId".length);
  const noteCol = Math.max(
    ...transitions.map((t) => summariseTransition(t).length),
    "transition".length,
  );
  const header =
    `| ${"caseId".padEnd(idCol)} | base.corr | head.corr | base.grnd | head.grnd | ${"transition".padEnd(noteCol)} |`;
  const sep = `| ${"-".repeat(idCol)} | --------- | --------- | --------- | --------- | ${"-".repeat(noteCol)} |`;
  const rows = transitions.map((t) => {
    const note = summariseTransition(t);
    return (
      `| ${t.caseId.padEnd(idCol)} | ${fmtBool(t.baseCorrect).padEnd(9)} | ${fmtBool(t.headCorrect).padEnd(9)} | ` +
      `${fmtBool(t.baseGrounded).padEnd(9)} | ${fmtBool(t.headGrounded).padEnd(9)} | ${note.padEnd(noteCol)} |`
    );
  });
  return [header, sep, ...rows].join("\n");
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

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const indexPath = resolve(process.cwd(), INDEX_RELATIVE_PATH);
  const entries = await readIndex(indexPath);
  if (entries.length === 0) {
    console.error(`[eval:compare] no runs found at ${indexPath}`);
    console.error(`[eval:compare] run \`npm run eval\` at least twice first.`);
    process.exit(1);
  }
  if (entries.length === 1) {
    console.error(`[eval:compare] only 1 run in the index — nothing to compare against.`);
    process.exit(1);
  }

  const { base, head } = pickPair(entries, args);

  const sameDataset = base.datasetHash === head.datasetHash;
  if (!sameDataset) {
    console.error(
      `[eval:compare] WARNING: base and head ran on different datasets ` +
        `(${base.datasetHash} vs ${head.datasetHash}). Aggregate deltas may not be meaningful; ` +
        `per-case transitions limited to overlapping ids.`,
    );
  }

  const baseResult = await loadResult(base.resultsFile);
  const headResult = await loadResult(head.resultsFile);

  console.log("Comparing eval runs");
  console.log(
    `  base (older): runId=${shortId(base.runId)} finished=${shortDate(base.finishedAt)} ` +
      `git=${shortGit(base)} dataset=${base.datasetPath}#${base.datasetHash}`,
  );
  console.log(
    `  head (newer): runId=${shortId(head.runId)} finished=${shortDate(head.finishedAt)} ` +
      `git=${shortGit(head)} dataset=${head.datasetPath}#${head.datasetHash}`,
  );
  console.log("  Δ = head − base\n");

  console.log("Aggregate deltas");
  console.log(renderAggregateTable(baseResult.aggregate, headResult.aggregate));

  for (const system of SYSTEMS) {
    const transitions = buildTransitions(baseResult, headResult, system);
    console.log(`\nPer-case transitions (system: ${system})`);
    console.log(renderTransitions(transitions));
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`eval:compare failed: ${message}`);
  process.exit(1);
});
