import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn("[OPENAI] WARNING: OPENAI_API_KEY is missing in environment");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function askOpenAIQuestion(question: string): Promise<string> {
  console.log("[OPENAI] ask →", question);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a concise, helpful teaching assistant." },
      { role: "user", content: question },
    ],
  });
  const ans = completion.choices?.[0]?.message?.content?.trim() ?? "";
  console.log("[OPENAI] answer len:", ans.length);
  return ans;
}

/**
 * NORMAL quiz generator: asks for 5 MCQs, 4 options, with correctIndex.
 */
export async function generateOpenAIQuiz(topic: string, level: string) {
  console.log("[OPENAI] quiz (normal) →", { topic, level });
  const sys =
    "You are a teaching assistant. Return STRICT JSON ONLY.\n" +
    "Schema:\n" +
    "{ \"topic\": string, \"level\": string, \"items\": [\n" +
    "  { \"id\": string, \"question\": string,\n" +
    "    \"options\": [string, string, string, string],\n" +
    "    \"correctIndex\": number (0..3)\n" +
    "  }\n" +
    "] }\n" +
    "Rules:\n" +
    "1) EXACTLY 5 questions.\n" +
    "2) ONLY multiple choice (no open).\n" +
    "3) Each question MUST have exactly 4 distinct options.\n" +
    "4) correctIndex MUST be an integer 0..3.\n" +
    "5) No commentary, no markdown. JSON only.";
  const user =
    `Create a ${level} difficulty quiz about "${topic}". ` +
    `Conform exactly to the schema.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices?.[0]?.message?.content ?? "{}";
  console.log("[OPENAI] quiz JSON len (normal):", content.length);
  return content;
}

/**
 * STRICT retry: repeats schema, emphasizes constraints, and gives a tiny example.
 */
export async function generateOpenAIQuizStrict(topic: string, level: string) {
  console.log("[OPENAI] quiz (STRICT) →", { topic, level });
  const sys =
    "Return STRICT JSON ONLY.\n" +
    "Schema:\n" +
    "{ \"topic\": string, \"level\": string, \"items\": [\n" +
    "  { \"id\": string, \"question\": string,\n" +
    "    \"options\": [string, string, string, string],\n" +
    "    \"correctIndex\": number (0..3)\n" +
    "  }\n" +
    "] }\n" +
    "Hard Rules:\n" +
    "• EXACTLY 5 questions.\n" +
    "• ONLY MCQ; NO 'open' items.\n" +
    "• Each 'options' length MUST be 4. Options MUST be distinct strings.\n" +
    "• 'id' MUST be a string, not a number.\n" +
    "• 'correctIndex' MUST be an integer between 0 and 3.\n" +
    "• No commentary, no markdown. JSON only.";
  const user =
    `Create a ${level} difficulty MCQ quiz about "${topic}".\n` +
    `Example shape (do not copy values):\n` +
    `{\n` +
    `  "topic":"${topic}", "level":"${level}",\n` +
    `  "items":[\n` +
    `    {"id":"1","question":"...","options":["A","B","C","D"],"correctIndex":1}\n` +
    `  ]\n` +
    `}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices?.[0]?.message?.content ?? "{}";
  console.log("[OPENAI] quiz JSON len (STRICT):", content.length);
  return content;
}
