import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage } from "../../types/chat.type";
import { isQuizPreviewMessage, parseQuizPreviewMessage } from "../../utils/quiz.utils";
import { InteractiveQuiz } from "../ai/InteractiveQuiz";
import { presignGet } from "../../services/s3.service";
import { Avatar } from "../common/Avatar";
import type { Gender } from "../../types/user.type";

const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

// We allow an extra UI-only field `senderName` that ChatPage injects.
type MsgWithName = ChatMessage & { senderName?: string };

export function MessageRow({ 
  msg, 
  meId, 
  onSend 
}: { 
  msg: ChatMessage; 
  meId: string;
  onSend?: (text: string) => void;
}) {
  const navigate = useNavigate();
  const m = msg as MsgWithName;
  const mine = m.senderId === meId;

  const handleProfileClick = () => {
    if (m.senderId && !mine) {
      navigate(`/profile/${m.senderId}`);
    } else if (mine) {
      navigate("/profile");
    }
  };
  const [quizExpanded, setQuizExpanded] = useState(false);
  const [quizDeclined, setQuizDeclined] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  // Fetch presigned URLs for images
  useEffect(() => {
    if (m.imageUrls && m.imageUrls.length > 0) {
      Promise.all(m.imageUrls.map((key) => presignGet(key)))
        .then((urls) => setImageUrls(urls))
        .catch((err) => {
          console.error("Failed to load image URLs:", err);
          setImageUrls([]);
        });
    } else {
      setImageUrls([]);
    }
  }, [m.imageUrls]);

  // Prefer username if provided; otherwise fall back to short id.
  // For own messages, show your username if present; else "You".
  const displayName = mine
    ? m.senderName ?? "You"
    : m.senderName ?? m.senderId.slice(-4);

  const timeStr = fmtTime(m.createdAt);
  const isPending = m.pending;

  // Check if this is a quiz preview message (only if text exists)
  const isQuizPreview = m.text ? isQuizPreviewMessage(m.text) : false;
  const quizData = isQuizPreview && m.text ? parseQuizPreviewMessage(m.text) : null;

  // If the sender is viewing their own quiz, show it directly (no preview)
  const shouldShowQuizDirectly = mine && isQuizPreview && quizData;
  
  // Show preview only if: it's a quiz preview, not declined, not expanded, and not sent by current user
  const shouldShowPreview = isQuizPreview && quizData && !quizDeclined && !quizExpanded && !mine;

  const handleQuizYes = () => {
    if (!quizData) return;
    // Show interactive quiz
    setQuizExpanded(true);
  };

  const handleQuizNo = () => {
    // Mark as declined to show refusal message
    setQuizDeclined(true);
  };

  return (
    <article 
      className={`row ${mine ? "me" : "other"}`}
      role="article"
      aria-label={`Message from ${displayName}${timeStr ? ` at ${timeStr}` : ""}`}
    >
      {!mine && (
        <div 
          className="message-avatar-left"
          onClick={handleProfileClick}
          style={{ cursor: "pointer" }}
          role="button"
          aria-label={`View ${displayName}'s profile`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleProfileClick();
            }
          }}
        >
          <Avatar
            keyPath={m.senderProfileImage ?? undefined}
            gender={(m.senderGender as Gender) ?? undefined}
            size={36}
            alt={displayName}
          />
        </div>
      )}
      <div 
        className={`bubble ${mine ? "bubble-me" : "bubble-other"}`}
        aria-label={isPending ? "Sending message" : undefined}
      >
        {shouldShowPreview ? (
          <div className="quiz-preview">
            <div className="quiz-preview-text">
              <strong>{quizData.sharedBy}</strong> shared a quiz at topic <strong>"{quizData.topic}"</strong>. Would you like to take it?
            </div>
            <div className="quiz-preview-actions">
              <button
                className="btn btn-primary btn-small"
                onClick={handleQuizYes}
                type="button"
                aria-label="Yes, show the quiz"
              >
                Yes
              </button>
              <button
                className="btn btn-small"
                onClick={handleQuizNo}
                type="button"
                aria-label="No, don't show the quiz"
              >
                No
              </button>
            </div>
          </div>
        ) : quizDeclined && quizData ? (
          <div className="quiz-declined">
            <div className="quiz-declined-text">
              You declined the quiz <strong>"{quizData.topic}"</strong> shared by <strong>{quizData.sharedBy}</strong>.
            </div>
          </div>
        ) : (shouldShowQuizDirectly || (isQuizPreview && quizExpanded && quizData)) ? (
          <div className="quiz-interactive-wrapper">
            <InteractiveQuiz quiz={quizData!.quiz} />
          </div>
        ) : (
          <div className="bubble-content">
            {imageUrls.length > 0 && (
              <div className="message-images">
                {imageUrls.map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt={`Image ${idx + 1}`}
                    className="message-image"
                    loading="lazy"
                  />
                ))}
              </div>
            )}
            {m.text && <div className="message-text">{m.text}</div>}
          </div>
        )}
      </div>
      {mine && (
        <div 
          className="message-avatar-right"
          onClick={handleProfileClick}
          style={{ cursor: "pointer" }}
          role="button"
          aria-label="View your profile"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleProfileClick();
            }
          }}
        >
          <Avatar
            keyPath={m.senderProfileImage ?? undefined}
            gender={(m.senderGender as Gender) ?? undefined}
            size={36}
            alt={displayName}
          />
        </div>
      )}
      <footer className="meta" aria-label="Message metadata">
        <span 
          className="meta-name" 
          aria-label={`Sender: ${displayName}`}
          onClick={handleProfileClick}
          style={{ cursor: "pointer", textDecoration: "underline" }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleProfileClick();
            }
          }}
        >
          {displayName}
        </span>
        {timeStr && (
          <time className="meta-time" dateTime={m.createdAt} aria-label={`Sent at ${timeStr}`}>
            {timeStr}
          </time>
        )}
        {isPending && (
          <span className="meta-pending" aria-label="Message is being sent">
            • sending…
          </span>
        )}
      </footer>
    </article>
  );
}
