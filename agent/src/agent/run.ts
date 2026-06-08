import { runAgent } from "./loop.js";
import { mockTools } from "./mockTools.js";

const DEFAULT_QUESTION =
  "What do my notes say about transformers, and summarize the document it came from?";

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

async function main(): Promise<void> {
  const question = process.argv[2] ?? DEFAULT_QUESTION;

  console.error(`Q: ${question}`);

  const result = await runAgent(question, mockTools);

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
  const toolsCalled = result.toolCalls.map((c) => c.tool).join(", ") || "(none)";
  console.error(
    `steps=${result.steps} tools=[${toolsCalled}] termination=${result.terminationReason} tokens_in=${result.inputTokens} tokens_out=${result.outputTokens}`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`agent run failed: ${message}`);
  process.exit(1);
});
