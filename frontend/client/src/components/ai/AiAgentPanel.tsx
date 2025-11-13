/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useRef, useState } from "react";
import { askQuestion, getQuiz, saveQuizResult, type QuizPayload } from "../../services/ai.services";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectAuthUser, setUser } from "../../store/slices/authSlice";
import { createQuizPreviewMessage } from "../../utils/quiz.utils";
import "../../styles/ai.css";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string };
type QuizStage = "idle" | "confirm" | "topic" | "difficulty" | "ready";

function newId() {
  return crypto.randomUUID();
}


export function AiAgentPanel({
  chatId,
  onShareQuiz,
}: {
  chatId?: string;
  onShareQuiz?: (quizText: string) => void;
} = {}) {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectAuthUser);
  const [messages, setMessages] = useState<Msg[]>([
    { id: "sys", role: "system", content: "You are a friendly AI tutor." },
    { id: "greet", role: "assistant", content: "How can I help you today?" },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Quiz state
  const [quizStage, setQuizStage] = useState<QuizStage>("idle");
  const [quizMode, setQuizMode] = useState(false);
  const [quizTopic, setQuizTopic] = useState("");
  const [quizLevel, setQuizLevel] = useState("");
  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [hasSharedQuiz, setHasSharedQuiz] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll for normal chat
  useEffect(() => {
    if (!quizMode) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, quizMode]);

  // ----- Regular Q&A -----
  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (quizMode) return; // disable during quiz
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const { cached, answer } = await askQuestion(text);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: answer + (cached ? " (from cache)" : "") },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: "Sorry, I couldn't reach the AI right now." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // ----- QUIZ FLOW -----
  const handleStartQuiz = () => {
    setQuizStage("confirm");
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "assistant", content: "Would you like to take a short quiz?" },
    ]);
  };

  const handleQuizAction = (choice: "yes" | "no") => {
    if (choice === "no") {
      setMessages((p) => [...p, { id: newId(), role: "assistant", content: "No problem!" }]);
      setQuizStage("idle");
      return;
    }
    setMessages((p) => [...p, { id: newId(), role: "assistant", content: "What topic?" }]);
    setQuizStage("topic");
  };

  const handleSubmitTopic = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setQuizTopic(t);
    setMessages((p) => [
      ...p,
      { id: newId(), role: "user", content: t },
      { id: newId(), role: "assistant", content: "Choose difficulty level:" },
    ]);
    setQuizStage("difficulty");
  };

  const handleSelectDifficulty = (level: string) => {
    setQuizLevel(level);
    setMessages((p) => [
      ...p,
      { id: newId(), role: "user", content: level },
      { id: newId(), role: "assistant", content: `Preparing a ${level} quiz about ${quizTopic}. Ready?` },
    ]);
    setQuizStage("ready");
  };

  const handleQuizActionFinal = async (choice: "yes" | "no") => {
    if (choice === "no") {
      setMessages((p) => [
        ...p,
        { id: newId(), role: "assistant", content: "Sure, maybe later!" },
      ]);
      setQuizStage("idle");
      return;
    }
    setQuizStage("idle");
    setMessages((p) => [
      ...p,
      { id: newId(), role: "assistant", content: "Generating your quiz..." },
    ]);
    const { quiz } = await getQuiz(quizTopic, quizLevel);
    setQuiz(quiz);
    setAnswers(Array(quiz.items.length).fill(-1));
    setQuizMode(true);
    setCurrentIdx(0);
    setHasSharedQuiz(false); // Reset when new quiz is created
  };

  const handleManualInput = () => {
    if (quizStage === "topic") {
      handleSubmitTopic(input);
      setInput("");
    } else {
      onSend();
    }
  };

  // ----- QUIZ MODE -----
  const handleSelectAnswer = (optionIndex: number) => {
    if (!quiz) return;
    const newAnswers = [...answers];
    newAnswers[currentIdx] = optionIndex;
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    if (!quiz) return;
    if (currentIdx < quiz.items.length - 1) setCurrentIdx(currentIdx + 1);
    else finishQuiz();
  };

  const handleBack = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleShareQuiz = () => {
    if (!quiz || !onShareQuiz || hasSharedQuiz) return;
    const username = user?.username || "Someone";
    const previewMessage = createQuizPreviewMessage(username, quiz);
    onShareQuiz(previewMessage);
    setHasSharedQuiz(true);
    setMessages((p) => [
      ...p,
      { id: newId(), role: "assistant", content: "✅ Quiz preview shared to chat!" },
    ]);
  };

  const finishQuiz = async () => {
    if (!quiz) return;
    let correct = 0;
    quiz.items.forEach((q, i) => {
      if (answers[i] === q.correctIndex) correct++;
    });
    
    // Save quiz result to backend
    try {
      const result = await saveQuizResult(quiz.topic, quiz.level, correct, quiz.items.length);
      console.log("[AI] Quiz result saved successfully");
      
      // Update user state with new quiz history if available
      if (result.quizHistory && user) {
        dispatch(setUser({ ...user, quizHistory: result.quizHistory }));
      }
    } catch (err) {
      console.error("[AI] Failed to save quiz result:", err);
      // Continue even if save fails - don't block user experience
    }
    
    setQuizMode(false);
    setMessages((p) => [
      ...p,
      { id: newId(), role: "assistant", content: `✅ You scored ${correct}/${quiz.items.length}! Great job!` },
    ]);
    setQuiz(null);
  };

  const handleQuitQuiz = () => {
    setQuizMode(false);
    setQuiz(null);
    setHasSharedQuiz(false); // Reset when quiz is quit
    setMessages((p) => [
      ...p,
      { id: newId(), role: "assistant", content: "Quiz exited. You can start a new one anytime!" },
    ]);
  };

  // ----- RENDER -----
  return (
    <div className="ai-root" role="complementary" aria-label="AI Teaching Assistant">
      {!quizMode && (
        <>
          <header className="ai-header" role="banner">
            <div className="ai-header-content">
              <h2 className="ai-title">AI Teaching Assistant</h2>
              <p className="ai-sub">Ask questions or start a quiz</p>
            </div>
            {(quizStage === "idle" || quizStage === "confirm") && (
              <button 
                className="btn btn-primary" 
                onClick={handleStartQuiz}
                aria-label="Start a quiz"
                type="button"
              >
                Start Quiz
              </button>
            )}
          </header>

          <div className="ai-list" ref={listRef} role="log" aria-label="AI conversation">
            {messages
              .filter((m) => m.role !== "system")
              .map((m) => (
                <article 
                  key={m.id} 
                  className={`ai-msg ${m.role}`}
                  role="article"
                  aria-label={`${m.role === "user" ? "Your" : "AI's"} message`}
                >
                  <div className="bubble" aria-label={m.role === "assistant" ? "AI response" : "Your question"}>
                    <div className="bubble-content">{m.content}</div>
                  </div>
                </article>
              ))}

            {/* yes/no & difficulty */}
            {quizStage === "confirm" && (
              <div className="ai-quiz-buttons" role="group" aria-label="Confirm quiz">
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleQuizAction("yes")}
                  type="button"
                  aria-label="Yes, start quiz"
                >
                  Yes
                </button>
                <button 
                  className="btn" 
                  onClick={() => handleQuizAction("no")}
                  type="button"
                  aria-label="No, cancel quiz"
                >
                  No
                </button>
              </div>
            )}

            {quizStage === "difficulty" && (
              <div className="ai-quiz-buttons difficulty" role="group" aria-label="Select difficulty level">
                {["Easy", "Intermediate", "Hard"].map((lvl) => (
                  <button 
                    key={lvl} 
                    className="btn btn-diff" 
                    onClick={() => handleSelectDifficulty(lvl)}
                    type="button"
                    aria-label={`Select ${lvl.toLowerCase()} difficulty`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}

            {quizStage === "ready" && (
              <div className="ai-quiz-buttons" role="group" aria-label="Confirm quiz start">
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleQuizActionFinal("yes")}
                  type="button"
                  aria-label="Yes, start the quiz"
                >
                  Yes
                </button>
                <button 
                  className="btn" 
                  onClick={() => handleQuizActionFinal("no")}
                  type="button"
                  aria-label="No, cancel"
                >
                  No
                </button>
              </div>
            )}
          </div>

          <form 
            className="ai-composer" 
            onSubmit={(e) => { e.preventDefault(); handleManualInput(); }}
            role="form"
            aria-label="Ask AI tutor"
          >
            <label htmlFor="ai-input" className="sr-only">
              Ask a question to the AI tutor
            </label>
            <input
              id="ai-input"
              className="ai-input"
              placeholder="Ask or chat with your tutor…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              aria-label="Ask a question"
              aria-describedby={loading ? "ai-loading" : undefined}
            />
            {loading && (
              <span id="ai-loading" className="sr-only" aria-live="polite">
                AI is thinking
              </span>
            )}
            <button 
              className="ai-send" 
              type="submit" 
              disabled={!input.trim() || loading}
              aria-label={loading ? "AI is processing" : "Send message"}
            >
              <span>{loading ? "..." : "Send"}</span>
            </button>
          </form>
        </>
      )}

      {quizMode && quiz && (
        <div className="quiz-fullscreen" role="main" aria-label="Quiz interface">
          <QuizView
            quiz={quiz}
            currentIdx={currentIdx}
            answers={answers}
            onSelect={handleSelectAnswer}
            onNext={handleNext}
            onBack={handleBack}
          />
          <div className="quiz-actions">
            {chatId && onShareQuiz && (
              <button 
                className="btn btn-primary" 
                onClick={handleShareQuiz}
                disabled={hasSharedQuiz}
                type="button"
                aria-label={hasSharedQuiz ? "Quiz already shared" : "Share quiz to chat"}
              >
                📤 {hasSharedQuiz ? "Quiz Shared" : "Share Quiz"}
              </button>
            )}
            <button 
              className="btn btn-quit" 
              onClick={handleQuitQuiz}
              type="button"
              aria-label="Quit quiz and return to chat"
            >
              Quit Quiz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Subcomponent for rendering the quiz question view */
function QuizView({
  quiz,
  currentIdx,
  answers,
  onSelect,
  onNext,
  onBack,
}: {
  quiz: QuizPayload;
  currentIdx: number;
  answers: number[];
  onSelect: (i: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const q = quiz.items[currentIdx];
  const userAnswer = answers[currentIdx];

  return (
    <div className="quiz-card" role="region" aria-label="Quiz question">
      <header className="quiz-header">
        <h3 className="quiz-title" aria-label={`Quiz topic: ${quiz.topic}, difficulty: ${quiz.level}`}>
          {quiz.topic} — {quiz.level}
        </h3>
        <div className="quiz-progress" aria-label={`Question ${currentIdx + 1} of ${quiz.items.length}`}>
          Question {currentIdx + 1} / {quiz.items.length}
        </div>
      </header>

      <div className="quiz-question" role="heading" aria-level={4}>
        {q.question}
      </div>
      <div className="quiz-options" role="radiogroup" aria-label="Quiz answer options">
        {q.options.map((opt, i) => (
          <button
            key={i}
            className={`quiz-option ${userAnswer === i ? "selected" : ""}`}
            onClick={() => onSelect(i)}
            type="button"
            aria-label={`Option ${String.fromCharCode(65 + i)}: ${opt}`}
            aria-pressed={userAnswer === i}
          >
            <span className="quiz-option-label">{String.fromCharCode(65 + i)}.</span>
            <span className="quiz-option-text">{opt}</span>
          </button>
        ))}
      </div>

      <nav className="quiz-nav" aria-label="Quiz navigation">
        <button 
          className="btn" 
          disabled={currentIdx === 0} 
          onClick={onBack}
          type="button"
          aria-label="Go to previous question"
        >
          Back
        </button>
        <button 
          className="btn btn-primary" 
          onClick={onNext}
          type="button"
          aria-label={currentIdx < quiz.items.length - 1 ? "Go to next question" : "Finish quiz"}
        >
          {currentIdx < quiz.items.length - 1 ? "Next" : "Finish"}
        </button>
      </nav>
    </div>
  );
}
