import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { ThinklysClient } from "../data/thinklysClient.js";
import { runAgent } from "../agent/loop.js";
import { connectMcpAndBuildTools } from "../agent/mcpTools.js";
import type { AgentRunResult, ToolCallTrace } from "../agent/types.js";
import { costFor } from "../observability/pricing.js";
import { runBaseline } from "./baseline.js";
import { judge } from "./judge.js";
import { aggregate, renderMarkdownTable } from "./metrics.js";
import type {
  EvalCase,
  EvalRunResult,
  Judgement,
  SystemRun,
} from "./types.js";

const AGENT_MODEL = "claude-opus-4-7";
const DEFAULT_DATASET = "eval/dataset.example.jsonl";

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expected: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

function utcIsoFileName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-") + ".json";
}

async function loadDataset(path: string): Promise<EvalCase[]> {
  const raw = await readFile(path, "utf8");
  const out: EvalCase[] = [];
  let lineNo = 0;
  for (const line of raw.split(/\r?\n/)) {
    lineNo += 1;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `dataset ${path} line ${lineNo}: JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const result = EvalCaseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `dataset ${path} line ${lineNo}: schema error: ${result.error.message}`,
      );
    }
    out.push(result.data);
  }
  return out;
}

/**
 * Reconstruct a "context" string from the agent's tool calls so the
 * groundedness judge has a fair shot. We dump every successful tool output
 * as JSON; the agent's grounded claims must trace back to one of these.
 */
function reconstructAgentContext(calls: ReadonlyArray<ToolCallTrace>): string {
  if (calls.length === 0) return "(agent made no tool calls)";
  const parts: string[] = [];
  for (const call of calls) {
    if (call.error || call.output === null || call.output === undefined) continue;
    let asText: string;
    try {
      asText = JSON.stringify(call.output);
    } catch {
      asText = String(call.output);
    }
    parts.push(
      `[step ${call.step} tool=${call.tool}]\n${asText}`,
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : "(no successful tool outputs)";
}

function buildAgentRun(
  caseId: string,
  result: AgentRunResult,
  latencyMs: number,
): SystemRun {
  const costUsd = costFor(
    AGENT_MODEL,
    result.inputTokens,
    result.outputTokens,
    result.cacheReadTokens,
    result.cacheCreationTokens,
  );
  return {
    system: "agent",
    caseId,
    finalText: result.finalText,
    toolCalls: result.toolCalls.length,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheCreationTokens: result.cacheCreationTokens,
    latencyMs,
    costUsd,
    contextSentToJudge: reconstructAgentContext(result.toolCalls),
  };
}

function buildErrorRun(
  system: "baseline" | "agent",
  caseId: string,
  err: unknown,
): SystemRun {
  const message = err instanceof Error ? err.message : String(err);
  return {
    system,
    caseId,
    finalText: `[error: ${message}]`,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    latencyMs: 0,
    costUsd: 0,
    contextSentToJudge: "(case errored)",
    error: message,
  };
}

async function main(): Promise<void> {
  const datasetArg = process.argv[2] ?? DEFAULT_DATASET;
  const datasetPath = resolve(process.cwd(), datasetArg);

  console.error(`[eval] dataset: ${datasetPath}`);
  const cases = await loadDataset(datasetPath);
  console.error(`[eval] cases loaded: ${cases.length}`);

  const startedAt = new Date();

  const thinklys = new ThinklysClient();
  const anthropic = new Anthropic();

  // Start the MCP subprocess once and reuse across cases.
  const mcp = await connectMcpAndBuildTools();

  const runs: SystemRun[] = [];
  const judgements: Judgement[] = [];
  let errorCount = 0;

  try {
    for (const c of cases) {
      console.error(`\n[eval] === case ${c.id}: ${c.question}`);

      // BASELINE
      let baselineRun: SystemRun;
      try {
        baselineRun = await runBaseline(c.id, c.question, thinklys, anthropic);
        console.error(
          `[eval]   baseline: ${baselineRun.inputTokens}/${baselineRun.outputTokens} tok, ${baselineRun.latencyMs}ms, $${baselineRun.costUsd.toFixed(6)}`,
        );
      } catch (err) {
        errorCount += 1;
        baselineRun = buildErrorRun("baseline", c.id, err);
        console.error(`[eval]   baseline ERROR: ${baselineRun.error}`);
      }
      runs.push(baselineRun);

      // AGENT
      let agentRun: SystemRun;
      try {
        const t0 = Date.now();
        const agentResult = await runAgent(c.question, mcp.tools);
        const latencyMs = Date.now() - t0;
        agentRun = buildAgentRun(c.id, agentResult, latencyMs);
        console.error(
          `[eval]   agent:    steps=${agentResult.steps} tools=${agentResult.toolCalls.length} ${agentRun.inputTokens}/${agentRun.outputTokens} tok, cache_read=${agentRun.cacheReadTokens}, ${latencyMs}ms, $${agentRun.costUsd.toFixed(6)}`,
        );
      } catch (err) {
        errorCount += 1;
        agentRun = buildErrorRun("agent", c.id, err);
        console.error(`[eval]   agent ERROR: ${agentRun.error}`);
      }
      runs.push(agentRun);

      // Judge each (skip if it errored — record a failing judgement)
      for (const run of [baselineRun, agentRun]) {
        if (run.error) {
          judgements.push({
            caseId: c.id,
            system: run.system,
            correct: false,
            correctReason: `system errored: ${run.error}`,
            grounded: false,
            groundedReason: `system errored: ${run.error}`,
          });
          continue;
        }
        try {
          const j = await judge(c, run, anthropic);
          judgements.push(j);
          console.error(
            `[eval]   judge[${run.system}]: correct=${j.correct} grounded=${j.grounded}`,
          );
        } catch (err) {
          errorCount += 1;
          const message = err instanceof Error ? err.message : String(err);
          judgements.push({
            caseId: c.id,
            system: run.system,
            correct: false,
            correctReason: `judge error: ${message}`,
            grounded: false,
            groundedReason: `judge error: ${message}`,
          });
          console.error(`[eval]   judge[${run.system}] ERROR: ${message}`);
        }
      }
    }
  } finally {
    await mcp.close();
  }

  const finishedAt = new Date();
  const agg = aggregate(runs, judgements);

  const result: EvalRunResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    cases,
    runs,
    judgements,
    aggregate: agg,
    errors: errorCount,
  };

  // Write results file
  const resultsDir = resolve(process.cwd(), "eval", "results");
  await mkdir(resultsDir, { recursive: true });
  const resultsFile = resolve(resultsDir, utcIsoFileName(finishedAt));
  await writeFile(resultsFile, JSON.stringify(result, null, 2), "utf8");

  // Print markdown table to stdout
  const table = renderMarkdownTable(agg);
  console.log(table);
  console.error(`\n[eval] results: ${resultsFile}`);
  console.error(`[eval] cases=${cases.length} errors=${errorCount}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`eval failed: ${message}`);
  process.exit(1);
});
