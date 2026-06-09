import type {
  EvalCase,
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
  adversarialCaseIds: ReadonlySet<string>,
  multihopCaseIds: ReadonlySet<string>,
): SystemAggregate {
  const filteredRuns = runs.filter((r) => r.system === system && !r.error);
  const filteredJudgements = judgements.filter((j) => j.system === system);

  const correctCount = filteredJudgements.filter((j) => j.correct).length;
  const groundedCount = filteredJudgements.filter((j) => j.grounded).length;

  const totalCostUsd = filteredRuns.reduce((acc, r) => acc + r.costUsd, 0);

  const adversarialJudgements = filteredJudgements.filter((j) =>
    adversarialCaseIds.has(j.caseId),
  );
  const adversarialCount = adversarialJudgements.length;
  const adversarialCorrect = adversarialJudgements.filter((j) => j.correct).length;

  const multihopJudgements = filteredJudgements.filter((j) =>
    multihopCaseIds.has(j.caseId),
  );
  const multihopCount = multihopJudgements.length;
  const multihopCorrect = multihopJudgements.filter((j) => j.correct).length;

  const base: SystemAggregate = {
    correctnessPct: pct(correctCount, filteredJudgements.length),
    groundednessPct: pct(groundedCount, filteredJudgements.length),
    meanInputTokens: mean(filteredRuns.map((r) => r.inputTokens)),
    meanOutputTokens: mean(filteredRuns.map((r) => r.outputTokens)),
    meanCacheReadTokens: mean(filteredRuns.map((r) => r.cacheReadTokens)),
    meanLatencyMs: mean(filteredRuns.map((r) => r.latencyMs)),
    meanToolCalls: mean(filteredRuns.map((r) => r.toolCalls)),
    totalCostUsd,
  };
  if (adversarialCount > 0) {
    base.adversarialPct = pct(adversarialCorrect, adversarialCount);
    base.adversarialCount = adversarialCount;
  }
  if (multihopCount > 0) {
    base.multihopPct = pct(multihopCorrect, multihopCount);
    base.multihopCount = multihopCount;
  }
  return base;
}

function buildAdversarialIdSet(cases: ReadonlyArray<EvalCase>): Set<string> {
  const out = new Set<string>();
  for (const c of cases) {
    if (c.kind !== undefined) out.add(c.id);
  }
  return out;
}

function buildMultihopIdSet(cases: ReadonlyArray<EvalCase>): Set<string> {
  const out = new Set<string>();
  for (const c of cases) {
    if (c.tags && c.tags.includes("multihop")) out.add(c.id);
  }
  return out;
}

export function aggregate(
  runs: ReadonlyArray<SystemRun>,
  judgements: ReadonlyArray<Judgement>,
  cases: ReadonlyArray<EvalCase>,
): { baseline: SystemAggregate; agent: SystemAggregate } {
  const adversarialIds = buildAdversarialIdSet(cases);
  const multihopIds = buildMultihopIdSet(cases);
  return {
    baseline: aggregateOne("baseline", runs, judgements, adversarialIds, multihopIds),
    agent: aggregateOne("agent", runs, judgements, adversarialIds, multihopIds),
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

function fmtAdv(agg: SystemAggregate): string {
  if (agg.adversarialPct === undefined || agg.adversarialCount === undefined) {
    return "n/a (no cases)";
  }
  return `${agg.adversarialPct.toFixed(1)}% (n=${agg.adversarialCount})`;
}

function fmtMultihop(agg: SystemAggregate): string {
  if (agg.multihopPct === undefined || agg.multihopCount === undefined) {
    return "n/a (no cases)";
  }
  return `${agg.multihopPct.toFixed(1)}% (n=${agg.multihopCount})`;
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
    ["Adversarial pass-rate", fmtAdv(b), fmtAdv(a)],
    ["Multi-hop pass-rate", fmtMultihop(b), fmtMultihop(a)],
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
