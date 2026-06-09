export type SystemName = "baseline" | "agent";

/**
 * Bump when EvalRunResult or RunIndexEntry change shape. Older files keep
 * working as long as readers branch on this field; we never silently
 * reinterpret a different shape.
 */
export const EVAL_SCHEMA_VERSION = 1 as const;

export interface EvalCase {
  id: string;
  question: string;
  expected: string;
  tags?: string[];
}

/**
 * Identifying / reproducibility metadata for a single eval invocation.
 * Written into the per-run results file and into every index entry, so a
 * runId is enough to look up the full result or to ask "what code was this".
 */
export interface RunMetadata {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  runId: string;
  gitSha: string | null;
  gitDirty: boolean;
  agentModel: string;
  baselineModel: string;
  judgeModel: string;
  datasetPath: string;
  datasetHash: string;
}

export interface SystemRun {
  system: SystemName;
  caseId: string;
  finalText: string;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  costUsd: number;
  /** Chunks fed to the answering call — used by the judge for groundedness. */
  contextSentToJudge: string;
  /** Set when the case failed end-to-end. */
  error?: string;
}

export interface Judgement {
  caseId: string;
  system: SystemName;
  correct: boolean;
  correctReason: string;
  grounded: boolean;
  groundedReason: string;
}

export interface SystemAggregate {
  correctnessPct: number;
  groundednessPct: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanCacheReadTokens: number;
  meanLatencyMs: number;
  meanToolCalls: number;
  totalCostUsd: number;
}

export interface EvalRunResult {
  metadata: RunMetadata;
  startedAt: string;
  finishedAt: string;
  cases: EvalCase[];
  runs: SystemRun[];
  judgements: Judgement[];
  aggregate: {
    baseline: SystemAggregate;
    agent: SystemAggregate;
  };
  errors: number;
}

/**
 * One line per run in `eval/index.jsonl`. Carries just enough to display
 * `eval:list` output and to dereference back to the full result JSON.
 *
 * Intentionally small: this file is committed to the repo, the full
 * results files are not (they may quote private chunk text).
 */
export interface RunIndexEntry {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  runId: string;
  finishedAt: string;
  gitSha: string | null;
  gitDirty: boolean;
  datasetPath: string;
  datasetHash: string;
  caseCount: number;
  errors: number;
  /** Path to the full results JSON, relative to the agent/ directory. */
  resultsFile: string;
  baseline: RunIndexSystemSummary;
  agent: RunIndexSystemSummary;
}

export interface RunIndexSystemSummary {
  correctnessPct: number;
  groundednessPct: number;
  totalCostUsd: number;
}
