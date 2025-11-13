/* eslint-disable @typescript-eslint/no-unused-vars */
import { useNavigate } from "react-router-dom";
import "../../styles/chat.css";

export function ChatHeader({ chatId, title = "Chat" }: { chatId: string; title?: string }) {
  const navigate = useNavigate();
  
  return (
    <div className="chat-header">
      <button 
        className="icon-btn" 
        onClick={() => navigate(-1)} 
        aria-label="Go back to chat list"
        type="button"
      >
        <svg 
          width="18" 
          height="18" 
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path 
            d="M15 18l-6-6 6-6" 
            stroke="currentColor" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="header-content">
        <h1 className="title" aria-label={`Chat: ${title}`}>
          {title}
        </h1>
      </div>
    </div>
  );
}
