type Props = {
  count: number;
  onNewChat: () => void;
};

export function Header({ count, onNewChat }: Props) {
  return (
    <header className="home-header no-wrap">
      <div className="home-title-wrap">
        <h1 className="home-title">Chats</h1>

        {/* circular count */}
        <span
          className="chat-count-circle"
          aria-live="polite"
          aria-label={`Total chats: ${count}`}
          title={`${count}`}
        >
          {count}
        </span>
      </div>

      <button
        type="button"
        className="new-chat-btn focusable"
        onClick={onNewChat}
        aria-label="Create a new chat"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
          <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" fill="currentColor" />
        </svg>
        New Chat
      </button>
    </header>
  );
}
