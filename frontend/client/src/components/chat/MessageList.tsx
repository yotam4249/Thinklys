import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../types/chat.type";
import { DayDivider } from "./DayDivider";
import { MessageRow } from "./MessageRow";

const asDayKey = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
};

export function MessageList({
  messages,
  meId,
  onSend,
}: {
  messages: ChatMessage[];
  meId: string;
  onSend?: (text: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // group by day for dividers
  const grouped = useMemo(() => {
    const map = new Map<string, ChatMessage[]>();
    for (const m of messages) {
      const key = asDayKey(m.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [messages]);

  // keep to bottom on new messages if already near bottom
  useEffect(() => {
    if (!listRef.current) return;
    if (atBottomRef.current) {
      requestAnimationFrame(() => {
        listRef.current!.scrollTo({ top: listRef.current!.scrollHeight, behavior: "smooth" });
      });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = nearBottom;
    setShowScrollDown(!nearBottom);
  };

  return (
    <>
      <div 
        className="messages" 
        ref={listRef} 
        onScroll={handleScroll} 
        aria-live="polite"
        aria-label="Chat messages"
        role="log"
        aria-atomic="false"
      >
        {grouped.length === 0 ? (
          <div className="messages-empty" role="status" aria-live="polite">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          grouped.map(([dayKey, dayMsgs]) => (
            <section key={dayKey} className="message-day-group" aria-label={`Messages from ${new Date(dayKey).toLocaleDateString()}`}>
              <DayDivider isoDay={dayKey} />
              {dayMsgs.map((m) => (
                <MessageRow key={m._id || m.clientId} msg={m} meId={meId} onSend={onSend} />
              ))}
            </section>
          ))
        )}
      </div>

      {showScrollDown && (
        <button
          className="scroll-down show"
          aria-label="Scroll to latest messages"
          onClick={() => {
            if (!listRef.current) return;
            listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
            atBottomRef.current = true;
            setShowScrollDown(false);
          }}
          type="button"
          aria-hidden={!showScrollDown}
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
              d="M6 9l6 6 6-6" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </>
  );
}
