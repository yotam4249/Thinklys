import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { costFor } from "./pricing.js";

// Strict-ish trace shape — we own the writer (`agent/src/agent/run.ts`),
// but old trace files on disk may be missing the Phase 6 fields, so most
// new ones are optional with sane fallbacks.
const ToolCallSchema = z.object({
  step: z.number(),
  tool: z.string(),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
});

const TraceSchema = z.object({
  trace_id: z.string().optional(),
  question: z.string(),
  mode: z.string(),
  model: z.string(),
  finalText: z.string(),
  terminationReason: z.string(),
  steps: z.number(),
  toolCalls: z.array(ToolCallSchema),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
  cost_usd: z.number().optional(),
});

type Trace = z.infer<typeof TraceSchema>;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function previewOutput(call: Trace["toolCalls"][number]): string {
  if (call.error) return `ERROR ${call.error}`;
  if (call.output === undefined || call.output === null) return "null";
  try {
    return JSON.stringify(call.output);
  } catch {
    return String(call.output);
  }
}

function printHeader(trace: Trace): void {
  const cacheRead = trace.cacheReadTokens ?? 0;
  const cacheCreate = trace.cacheCreationTokens ?? 0;
  const cost =
    trace.cost_usd ??
    costFor(
      trace.model,
      trace.inputTokens,
      trace.outputTokens,
      cacheRead,
      cacheCreate,
    );

  const lines: string[] = [
    "─── trace ───",
    `trace_id:     ${trace.trace_id ?? "(none)"}`,
    `mode:         ${trace.mode}`,
    `model:        ${trace.model}`,
    `question:     ${trace.question}`,
    `termination:  ${trace.terminationReason}`,
    `steps:        ${trace.steps}`,
    `tokens:       in=${trace.inputTokens} out=${trace.outputTokens} cache_read=${cacheRead} cache_create=${cacheCreate}`,
    `cost:         $${cost.toFixed(6)}`,
  ];
  for (const line of lines) console.log(line);
}

function printToolTable(trace: Trace): void {
  if (trace.toolCalls.length === 0) {
    console.log("\n(no tool calls)");
    return;
  }
  const headers = ["step", "tool", "latency_ms", "output_preview"];
  const rows = trace.toolCalls.map((call) => [
    String(call.step),
    call.tool,
    String(call.latencyMs),
    truncate(previewOutput(call), 80),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const widthFor = (i: number): number => widths[i] ?? 0;

  console.log("\n─── tool calls ───");
  console.log(headers.map((h, i) => padRight(h, widthFor(i))).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(row.map((c, i) => padRight(c, widthFor(i))).join("  "));
  }
}

function printFinal(trace: Trace): void {
  console.log("\n─── final answer ───");
  console.log(trace.finalText);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "usage: tsx src/observability/print-trace.ts <path-to-trace.json>",
    );
    process.exit(2);
  }
  const path = resolve(process.cwd(), arg);
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const trace = TraceSchema.parse(parsed);

  printHeader(trace);
  printToolTable(trace);
  printFinal(trace);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`print-trace failed: ${message}`);
  process.exit(1);
});
