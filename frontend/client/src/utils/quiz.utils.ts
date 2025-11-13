import type { QuizPayload } from "../services/ai.services";

/**
 * Format quiz as a readable text message for sharing in chat
 */
export function formatQuizForChat(quiz: QuizPayload): string {
  let text = `📚 Quiz: ${quiz.topic} (${quiz.level} difficulty)\n\n`;
  
  quiz.items.forEach((item, idx) => {
    text += `${idx + 1}. ${item.question}\n`;
    item.options.forEach((opt, optIdx) => {
      const letter = String.fromCharCode(65 + optIdx); // A, B, C, D
      const correctMark = optIdx === item.correctIndex ? " ✓" : "";
      text += `   ${letter}. ${opt}${correctMark}\n`;
    });
    text += "\n";
  });
  
  text += `Take this quiz and test your knowledge!`;
  return text;
}

/**
 * Create a quiz preview message with encoded quiz data
 */
export function createQuizPreviewMessage(username: string, quiz: QuizPayload): string {
  // Encode quiz data as base64 JSON to embed in message
  const quizData = btoa(JSON.stringify(quiz));
  // Format: [QUIZ_PREVIEW]encoded_data|username|topic|level
  return `[QUIZ_PREVIEW]${quizData}|${username}|${quiz.topic}|${quiz.level}`;
}

/**
 * Check if a message is a quiz preview
 */
export function isQuizPreviewMessage(text?: string | null): boolean {
  return text ? text.startsWith("[QUIZ_PREVIEW]") : false;
}

/**
 * Parse quiz preview message and extract data
 */
export function parseQuizPreviewMessage(text?: string | null): {
  quiz: QuizPayload;
  sharedBy: string;
  topic: string;
  level: string;
} | null {
  if (!text || !isQuizPreviewMessage(text)) return null;
  
  try {
    const content = text.replace("[QUIZ_PREVIEW]", "");
    const [encodedQuiz, sharedBy, topic, level] = content.split("|");
    const quiz = JSON.parse(atob(encodedQuiz)) as QuizPayload;
    return { quiz, sharedBy, topic, level };
  } catch {
    return null;
  }
}

