import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AgentTool } from "../agent/types.js";
import type { Plan } from "./types.js";

const PLANNER_MODEL = "claude-opus-4-7";
const PLANNER_MAX_TOKENS = 1024;
const MAX_SUBTASKS = 5;
const MAX_DEPTH = 2;

export const PLANNER_SYSTEM_PROMPT = [
  "You are the PLANNER for a multi-agent retrieval system.",
  "Given the user's question and a list of available tools, decompose the question into AT MOST 5 small subtasks.",
  "Each subtask is given to a focused executor that can only call a subset of tools.",
  "Prefer 1 subtask when the question is simple. Add a second/third subtask only when the question genuinely requires it (multi-hop, compare across documents, list-then-summarize).",
  "Subtasks may depend on earlier ones via `dependsOn` — keep dependency depth ≤ 2.",
  "Each subtask's `allowedTools` MUST be a non-empty subset of the available tool names.",
  'Respond with JSON only: {"reasoning": string, "subtasks": [{"id": string, "question": string, "allowedTools": string[], "dependsOn": string[]}]}.',
  "No prose outside the JSON.",
].join(" ");

const SubtaskSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  allowedTools: z.array(z.string().min(1)).min(1),
  dependsOn: z.array(z.string().min(1)),
});

const PlanSchema = z.object({
  reasoning: z.string(),
  subtasks: z.array(SubtaskSchema).min(1).max(MAX_SUBTASKS),
});

function firstJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("planner: no '{' found in response");
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error("planner: unterminated JSON in response");
}

function extractText(content: ReadonlyArray<Anthropic.Messages.ContentBlock>): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

function buildToolCatalog(tools: ReadonlyArray<AgentTool>): string {
  return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}

/**
 * Validate Plan beyond what zod can express:
 *  - allowedTools must reference real tool names
 *  - dependsOn must reference earlier subtask ids
 *  - dependency depth ≤ MAX_DEPTH
 */
function validatePlan(plan: Plan, toolNames: ReadonlySet<string>): void {
  const seenIds = new Set<string>();
  const depthOf = new Map<string, number>();
  for (const st of plan.subtasks) {
    if (seenIds.has(st.id)) {
      throw new Error(`planner: duplicate subtask id "${st.id}"`);
    }
    seenIds.add(st.id);
    for (const dep of st.dependsOn) {
      if (!seenIds.has(dep)) {
        throw new Error(
          `planner: subtask "${st.id}" depends on "${dep}" which is not declared earlier`,
        );
      }
    }
    const depDepths = st.dependsOn.map((d) => depthOf.get(d) ?? 0);
    const ownDepth = depDepths.length === 0 ? 0 : 1 + Math.max(...depDepths);
    if (ownDepth > MAX_DEPTH) {
      throw new Error(
        `planner: subtask "${st.id}" depth ${ownDepth} exceeds MAX_DEPTH=${MAX_DEPTH}`,
      );
    }
    depthOf.set(st.id, ownDepth);
    for (const toolName of st.allowedTools) {
      if (!toolNames.has(toolName)) {
        throw new Error(
          `planner: subtask "${st.id}" allows unknown tool "${toolName}"`,
        );
      }
    }
  }
}

export async function planQuestion(
  question: string,
  tools: ReadonlyArray<AgentTool>,
  anthropic: Anthropic,
): Promise<{ plan: Plan; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }> {
  const toolCatalog = buildToolCatalog(tools);
  const userMessage = `Available tools:\n${toolCatalog}\n\nUser question: ${question}`;

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: PLANNER_MAX_TOKENS,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  const raw = extractText(response.content);
  const parsed = PlanSchema.parse(firstJsonObject(raw));

  const toolNames = new Set(tools.map((t) => t.name));
  validatePlan(parsed, toolNames);

  const usage = response.usage as unknown as {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  return {
    plan: parsed,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0,
    cacheCreationTokens:
      typeof usage.cache_creation_input_tokens === "number"
        ? usage.cache_creation_input_tokens
        : 0,
  };
}
