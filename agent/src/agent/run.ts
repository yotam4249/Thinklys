import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runAgent } from "./loop.js";
import { mockTools } from "./mockTools.js";
import { connectMcpAndBuildTools } from "./mcpTools.js";
import type { AgentRunResult, AgentTool } from "./types.js";
import { costFor } from "../observability/pricing.js";

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
  return {
    mock,
    question: positional[0] ?? DEFAULT_QUESTION,
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function utcIsoFileName(date: Date): string {
  // 2026-06-08T12-34-56-789Z.json — colons aren't safe on every filesystem.
  return date.toISOString().replace(/[:.]/g, "-") + ".json";
}

async function writeTrace(params: {
  question: string;
  mode: "MOCK" | "LIVE (MCP)";
  model: string;
  result: AgentRunResult;
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
    question: params.question,
    mode: params.mode,
    model: params.model,
    finalText: params.result.finalText,
    terminationReason: params.result.terminationReason,
    steps: params.result.steps,
    toolCalls: params.result.toolCalls,
    inputTokens: params.result.inputTokens,
    outputTokens: params.result.outputTokens,
    cacheReadTokens: params.result.cacheReadTokens,
    cacheCreationTokens: params.result.cacheCreationTokens,
    cost_usd: costUsd,
    cache: {
      cache_read_input_tokens: params.result.cacheReadTokens,
      cache_creation_input_tokens: params.result.cacheCreationTokens,
    },
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

    // Make sure ctrl-C during a long live run still cleans up the subprocess.
    const onSigint = (): void => {
      console.error("[run] received SIGINT, shutting down MCP subprocess…");
      void handle.close().finally(() => process.exit(130));
    };
    process.once("SIGINT", onSigint);
  }

  try {
    const result = await runAgent(args.question, tools);

    for (const call of result.toolCalls) {
      const argsStr = truncate(JSON.stringify(call.input ?? {}), 120);
      const outStr = call.error
        ? `ERROR ${call.error}`
        : truncate(JSON.stringify(call.output ?? null), 200);
      console.error(`→ [step ${call.step}] ${call.tool}(${argsStr}) → ${outStr}`);
    }
    console.error("─────");

    console.log(result.finalText);

    console.error("─────");
    const toolsCalled =
      result.toolCalls.map((c) => c.tool).join(", ") || "(none)";
    console.error(
      `steps=${result.steps} tools=[${toolsCalled}] termination=${result.terminationReason} tokens_in=${result.inputTokens} tokens_out=${result.outputTokens} cache_read=${result.cacheReadTokens} cache_create=${result.cacheCreationTokens}`,
    );

    const tracePath = await writeTrace({
      question: args.question,
      mode,
      model: DEFAULT_MODEL,
      result,
    });
    console.error(`trace: ${tracePath}`);
  } finally {
    if (closeMcp) {
      await closeMcp();
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`agent run failed: ${message}`);
  process.exit(1);
});
