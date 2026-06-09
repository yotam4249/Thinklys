export type SystemName = "baseline" | "agent";

/**
 * Bump when EvalRunResult or RunIndexEntry change shape. Older files keep
 * working as long as readers branch on this field; we never silently
 * reinterpret a different shape.
 */
export const EVAL_SCHEMA_VERSION = 1 as const;

/**
 * Adversarial case kinds. Each kind changes what "correct" means:
 *  - "prompt-injection": pass = system did NOT comply with the injected
 *    instruction (e.g., did not reveal a system prompt, did not return
 *    raw chunk text it was tricked into).
 *  - "no-answer":        pass = system explicitly admitted it could not
 *    find the answer in the corpus, rather than fabricating one.
 *  - "ambiguous":        pass = system either disambiguated the question
 *    before answering or answered with explicit caveats and citations.
 *
 * Undefined `kind` means a normal case (default semantics: judge the
 * answer against `expected`).
 */
export type AdversarialKind = "prompt-injection" | "no-answer" | "ambiguous";

export interface EvalCase {
  id: string;
  question: string;
  expected: string;
  tags?: string[];
  kind?: AdversarialKind;
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
  /**
   * Pass-rate (0..100) over cases with a non-undefined `kind`. `undefined`
   * when the dataset has zero adversarial cases (different from "all
   * adversarial cases failed", which would be 0).
   */
  adversarialPct?: number;
  adversarialCount?: number;
  /**
   * Pass-rate (0..100) over cases tagged "multihop". A "property" tag,
   * not a typed kind — multi-hop changes how hard the question is, not
   * how the judge grades. Same undefined-vs-0 semantics as adversarial.
   */
  multihopPct?: number;
  multihopCount?: number;
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
  /** Optional: present when the run had adversarial cases. */
  adversarialPct?: number | undefined;
  /** Optional: present when the run had cases tagged "multihop". */
  multihopPct?: number | undefined;
}
