import type {
  Judgement,
  SystemAggregate,
  SystemName,
  SystemRun,
} from "./types.js";

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return (numerator / denominator) * 100;
}

function aggregateOne(
  system: SystemName,
  runs: ReadonlyArray<SystemRun>,
  judgements: ReadonlyArray<Judgement>,
): SystemAggregate {
  const filteredRuns = runs.filter((r) => r.system === system && !r.error);
  const filteredJudgements = judgements.filter((j) => j.system === system);

  const correctCount = filteredJudgements.filter((j) => j.correct).length;
  const groundedCount = filteredJudgements.filter((j) => j.grounded).length;

  const totalCostUsd = filteredRuns.reduce((acc, r) => acc + r.costUsd, 0);

  return {
    correctnessPct: pct(correctCount, filteredJudgements.length),
    groundednessPct: pct(groundedCount, filteredJudgements.length),
    meanInputTokens: mean(filteredRuns.map((r) => r.inputTokens)),
    meanOutputTokens: mean(filteredRuns.map((r) => r.outputTokens)),
    meanCacheReadTokens: mean(filteredRuns.map((r) => r.cacheReadTokens)),
    meanLatencyMs: mean(filteredRuns.map((r) => r.latencyMs)),
    meanToolCalls: mean(filteredRuns.map((r) => r.toolCalls)),
    totalCostUsd,
  };
}

export function aggregate(
  runs: ReadonlyArray<SystemRun>,
  judgements: ReadonlyArray<Judgement>,
): { baseline: SystemAggregate; agent: SystemAggregate } {
  return {
    baseline: aggregateOne("baseline", runs, judgements),
    agent: aggregateOne("agent", runs, judgements),
  };
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtNum(n: number, digits = 1): string {
  return n.toFixed(digits);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function renderMarkdownTable(agg: {
  baseline: SystemAggregate;
  agent: SystemAggregate;
}): string {
  const b = agg.baseline;
  const a = agg.agent;
  const rows: Array<[string, string, string]> = [
    ["Correctness", fmtPct(b.correctnessPct), fmtPct(a.correctnessPct)],
    ["Groundedness", fmtPct(b.groundednessPct), fmtPct(a.groundednessPct)],
    [
      "Mean tool calls / Q",
      fmtNum(b.meanToolCalls, 2),
      fmtNum(a.meanToolCalls, 2),
    ],
    [
      "Mean input tokens / Q",
      fmtNum(b.meanInputTokens, 0),
      fmtNum(a.meanInputTokens, 0),
    ],
    [
      "Mean cache-read tokens",
      fmtNum(b.meanCacheReadTokens, 0),
      fmtNum(a.meanCacheReadTokens, 0),
    ],
    [
      "Mean output tokens / Q",
      fmtNum(b.meanOutputTokens, 0),
      fmtNum(a.meanOutputTokens, 0),
    ],
    [
      "Mean latency (ms)",
      fmtNum(b.meanLatencyMs, 0),
      fmtNum(a.meanLatencyMs, 0),
    ],
    ["Total cost (USD)", fmtUsd(b.totalCostUsd), fmtUsd(a.totalCostUsd)],
  ];

  const header = [
    "| Metric                   | Top-k RAG (baseline) | Agent (this work) |",
    "| ------------------------ | -------------------- | ----------------- |",
  ];
  const body = rows.map(([metric, base, agent]) => {
    return `| ${metric.padEnd(24)} | ${base.padEnd(20)} | ${agent.padEnd(17)} |`;
  });
  return [...header, ...body].join("\n");
}
