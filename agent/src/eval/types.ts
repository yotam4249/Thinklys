export type SystemName = "baseline" | "agent";

export interface EvalCase {
  id: string;
  question: string;
  expected: string;
  tags?: string[];
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
