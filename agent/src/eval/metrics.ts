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
  options?: { includePlannerExecutor?: boolean },
): {
  baseline: SystemAggregate;
  agent: SystemAggregate;
  plannerExecutor?: SystemAggregate;
} {
  const adversarialIds = buildAdversarialIdSet(cases);
  const multihopIds = buildMultihopIdSet(cases);
  const out: {
    baseline: SystemAggregate;
    agent: SystemAggregate;
    plannerExecutor?: SystemAggregate;
  } = {
    baseline: aggregateOne("baseline", runs, judgements, adversarialIds, multihopIds),
    agent: aggregateOne("agent", runs, judgements, adversarialIds, multihopIds),
  };
  if (options?.includePlannerExecutor) {
    out.plannerExecutor = aggregateOne(
      "planner-executor",
      runs,
      judgements,
      adversarialIds,
      multihopIds,
    );
  }
  return out;
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
  plannerExecutor?: SystemAggregate;
}): string {
  const b = agg.baseline;
  const a = agg.agent;
  const pe = agg.plannerExecutor;

  const cell = (
    extractor: (s: SystemAggregate) => string,
    forPE?: (s: SystemAggregate) => string,
  ): string[] => {
    const row = [extractor(b), extractor(a)];
    if (pe !== undefined) row.push((forPE ?? extractor)(pe));
    return row;
  };

  const rows: Array<[string, ...string[]]> = [
    ["Correctness", ...cell((s) => fmtPct(s.correctnessPct))],
    ["Groundedness", ...cell((s) => fmtPct(s.groundednessPct))],
    ["Adversarial pass-rate", ...cell((s) => fmtAdv(s))],
    ["Multi-hop pass-rate", ...cell((s) => fmtMultihop(s))],
    ["Mean tool calls / Q", ...cell((s) => fmtNum(s.meanToolCalls, 2))],
    ["Mean input tokens / Q", ...cell((s) => fmtNum(s.meanInputTokens, 0))],
    ["Mean cache-read tokens", ...cell((s) => fmtNum(s.meanCacheReadTokens, 0))],
    ["Mean output tokens / Q", ...cell((s) => fmtNum(s.meanOutputTokens, 0))],
    ["Mean latency (ms)", ...cell((s) => fmtNum(s.meanLatencyMs, 0))],
    ["Total cost (USD)", ...cell((s) => fmtUsd(s.totalCostUsd))],
  ];

  const titles: string[] = ["Metric", "Top-k RAG (baseline)", "Agent (single)"];
  if (pe !== undefined) titles.push("Planner-Executor");

  const widths = titles.map((t, colIdx) => {
    const maxCell = rows.reduce((max, r) => {
      const v = r[colIdx + 1] ?? "";
      return v.length > max ? v.length : max;
    }, 0);
    return Math.max(t.length, maxCell, colIdx === 0 ? 24 : 17);
  });

  const headerLine =
    "| " +
    titles.map((t, i) => t.padEnd(widths[i] ?? t.length)).join(" | ") +
    " |";
  const sepLine =
    "| " +
    widths.map((w) => "-".repeat(w)).join(" | ") +
    " |";
  const body = rows.map((r) => {
    const cells = [r[0], ...r.slice(1)];
    return (
      "| " +
      cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join(" | ") +
      " |"
    );
  });
  return [headerLine, sepLine, ...body].join("\n");
}
