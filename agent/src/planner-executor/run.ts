import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { connectMcpAndBuildTools } from "../agent/mcpTools.js";
import { mockTools } from "../agent/mockTools.js";
import type { AgentTool } from "../agent/types.js";
import { costFor } from "../observability/pricing.js";
import { runPlannerExecutor } from "./orchestrator.js";
import type { PlannerExecutorResult } from "./types.js";

const DEFAULT_QUESTION =
  "What do my notes say about transformers, and summarize the document it came from?";
const DEFAULT_MODEL = "claude-opus-4-7";

interface CliArgs {
  mock: boolean;
  question: string;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const positional: string[] = [];
  let mock = false;
  for (const raw of argv) {
    if (raw === "--mock") {
      mock = true;
      continue;
    }
    if (raw === "--") continue;
    positional.push(raw);
  }
  return { mock, question: positional[0] ?? DEFAULT_QUESTION };
}

function utcIsoFileName(date: Date): string {
  return "pe-" + date.toISOString().replace(/[:.]/g, "-") + ".json";
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

async function writeTrace(params: {
  question: string;
  mode: "MOCK" | "LIVE (MCP)";
  model: string;
  result: PlannerExecutorResult;
}): Promise<string> {
  const dir = resolve(process.cwd(), "runs");
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, utcIsoFileName(new Date()));
  const costUsd = costFor(
    params.model,
    params.result.inputTokens,
    params.result.outputTokens,
    params.result.cacheReadTokens,
    params.result.cacheCreationTokens,
  );
  const trace = {
    trace_id: randomUUID(),
    system: "planner-executor",
    question: params.question,
    mode: params.mode,
    model: params.model,
    finalText: params.result.finalText,
    terminationReason: params.result.terminationReason,
    steps: params.result.steps,
    plan: params.result.plan,
    executorResults: params.result.executorResults,
    toolCalls: params.result.toolCalls,
    inputTokens: params.result.inputTokens,
    outputTokens: params.result.outputTokens,
    cacheReadTokens: params.result.cacheReadTokens,
    cacheCreationTokens: params.result.cacheCreationTokens,
    cost_usd: costUsd,
  };
  await writeFile(file, JSON.stringify(trace, null, 2), "utf8");
  return file;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode: "MOCK" | "LIVE (MCP)" = args.mock ? "MOCK" : "LIVE (MCP)";
  console.error(`mode: ${mode}`);
  console.error(`Q: ${args.question}`);

  let tools: ReadonlyArray<AgentTool>;
  let closeMcp: (() => Promise<void>) | null = null;

  if (args.mock) {
    tools = mockTools;
  } else {
    const handle = await connectMcpAndBuildTools();
    tools = handle.tools;
    closeMcp = handle.close;
    const onSigint = (): void => {
      console.error("[pe] received SIGINT, shutting down MCP subprocess…");
      void handle.close().finally(() => process.exit(130));
    };
    process.once("SIGINT", onSigint);
  }

  try {
    const result = await runPlannerExecutor(args.question, tools);

    console.error("─── plan ───");
    console.error(`reasoning: ${result.plan.reasoning}`);
    for (const st of result.plan.subtasks) {
      const deps = st.dependsOn.length > 0 ? ` ← [${st.dependsOn.join(",")}]` : "";
      console.error(
        `  ${st.id}${deps} tools=[${st.allowedTools.join(",")}] q="${truncate(st.question, 90)}"`,
      );
    }
    console.error("─── executors ───");
    for (const r of result.executorResults) {
      const status = r.error ? `ERROR ${r.error}` : `${r.steps} steps, ${r.toolCalls.length} tools`;
      console.error(`  ${r.subtaskId}: ${status}`);
    }
    console.error("─────");

    console.log(result.finalText);

    console.error("─────");
    console.error(
      `steps=${result.steps} subtasks=${result.plan.subtasks.length} termination=${result.terminationReason} ` +
        `tokens_in=${result.inputTokens} tokens_out=${result.outputTokens} ` +
        `cache_read=${result.cacheReadTokens} cache_create=${result.cacheCreationTokens}`,
    );

    const tracePath = await writeTrace({
      question: args.question,
      mode,
      model: DEFAULT_MODEL,
      result,
    });
    console.error(`trace: ${tracePath}`);
  } finally {
    if (closeMcp) await closeMcp();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`planner-executor run failed: ${message}`);
  process.exit(1);
});
