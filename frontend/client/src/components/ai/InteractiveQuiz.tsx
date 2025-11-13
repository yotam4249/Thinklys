import { useState } from "react";
import type { QuizPayload } from "../../services/ai.services";
import { saveQuizResult } from "../../services/ai.services";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setUser, selectAuthUser } from "../../store/slices/authSlice";

type QuizState = "questions" | "score";

export function InteractiveQuiz({ 
  quiz,
  onComplete 
}: { 
  quiz: QuizPayload;
  onComplete?: (score: number, total: number) => void;
}) {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectAuthUser);
  const [state, setState] = useState<QuizState>("questions");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>(Array(quiz.items.length).fill(-1));
  const [score, setScore] = useState<number | null>(null);

  const handleSelectAnswer = (optionIndex: number) => {
    const newAnswers = [...answers];
    newAnswers[currentIdx] = optionIndex;
    setAnswers(newAnswers);
  };

  const handleNext = async () => {
    if (currentIdx < quiz.items.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      // Finish quiz - calculate score
      let correct = 0;
      quiz.items.forEach((q, i) => {
        if (answers[i] === q.correctIndex) correct++;
      });
      setScore(correct);
      setState("score");
      
      // Save quiz result to backend
      try {
        const result = await saveQuizResult(quiz.topic, quiz.level, correct, quiz.items.length);
        console.log("[Quiz] Quiz result saved successfully");
        
        // Update user state with new quiz history if available
        if (result.quizHistory && user) {
          dispatch(setUser({ ...user, quizHistory: result.quizHistory }));
        }
      } catch (err) {
        console.error("[Quiz] Failed to save quiz result:", err);
        // Continue even if save fails - don't block user experience
      }
      
      onComplete?.(correct, quiz.items.length);
    }
  };

  const handleBack = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleRestart = () => {
    setState("questions");
    setCurrentIdx(0);
    setAnswers(Array(quiz.items.length).fill(-1));
    setScore(null);
  };

  if (state === "score") {
    return (
      <QuizScoreScreen
        score={score ?? 0}
        total={quiz.items.length}
        topic={quiz.topic}
        level={quiz.level}
        onRestart={handleRestart}
      />
    );
  }

  return (
    <QuizQuestionView
      quiz={quiz}
      currentIdx={currentIdx}
      answers={answers}
      onSelect={handleSelectAnswer}
      onNext={handleNext}
      onBack={handleBack}
    />
  );
}

function QuizQuestionView({
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
    <div className="chat-quiz-container" role="region" aria-label="Quiz question">
      <div className="chat-quiz-header">
        <div className="chat-quiz-title">
          {quiz.topic} — {quiz.level}
        </div>
        <div className="chat-quiz-progress">
          Question {currentIdx + 1} / {quiz.items.length}
        </div>
      </div>

      <div className="chat-quiz-question">
        {q.question}
      </div>
      
      <div className="chat-quiz-options" role="radiogroup" aria-label="Quiz answer options">
        {q.options.map((opt, i) => (
          <button
            key={i}
            className={`chat-quiz-option ${userAnswer === i ? "selected" : ""}`}
            onClick={() => onSelect(i)}
            type="button"
            aria-label={`Option ${String.fromCharCode(65 + i)}: ${opt}`}
            aria-pressed={userAnswer === i}
          >
            <span className="chat-quiz-option-label">{String.fromCharCode(65 + i)}.</span>
            <span className="chat-quiz-option-text">{opt}</span>
          </button>
        ))}
      </div>

      <nav className="chat-quiz-nav" aria-label="Quiz navigation">
        <button 
          className="btn btn-small" 
          disabled={currentIdx === 0} 
          onClick={onBack}
          type="button"
          aria-label="Go to previous question"
        >
          Back
        </button>
        <button 
          className="btn btn-primary btn-small" 
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

function QuizScoreScreen({
  score,
  total,
  topic,
  level,
  onRestart,
}: {
  score: number;
  total: number;
  topic: string;
  level: string;
  onRestart: () => void;
}) {
  const percentage = Math.round((score / total) * 100);
  
  return (
    <div className="chat-quiz-score" role="region" aria-label="Quiz results">
      <div className="chat-quiz-score-header">
        <h3 className="chat-quiz-score-title">Quiz Complete! 🎉</h3>
        <p className="chat-quiz-score-subtitle">
          {topic} — {level}
        </p>
      </div>
      
      <div className="chat-quiz-score-display">
        <div className="chat-quiz-score-number">
          {score} / {total}
        </div>
        <div className="chat-quiz-score-percentage">
          {percentage}%
        </div>
      </div>

      <div className="chat-quiz-score-message">
        {percentage >= 80 
          ? "Excellent work! 🌟" 
          : percentage >= 60 
          ? "Good job! 👍" 
          : "Keep practicing! 💪"}
      </div>

      <button
        className="btn btn-primary btn-small"
        onClick={onRestart}
        type="button"
        aria-label="Retake quiz"
      >
        Retake Quiz
      </button>
    </div>
  );
}

