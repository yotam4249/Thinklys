import type { ChatListItem } from "../../types/chatList.type";

type Props = {
  item: ChatListItem;
  onOpen: (id: string) => void;
  onJoin: (id: string) => void;
  isJoining: boolean;
  fmtTime: (iso?: string) => string;
};

export function ChatActions({ item, onOpen, onJoin, isJoining, fmtTime }: Props) {
  const isGroup = item.type === "group";

  return (
    <div className="item-right" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="item-time">{fmtTime(item.lastMessageAt)}</div>

      {isGroup ? (
        item.isMember ? (
          <button
            className="btn-primary focusable"
            onClick={() => onOpen(item.id)}
          >
            Enter chat
          </button>
        ) : (
          <button
            className="btn-ghost focusable"
            onClick={() => !isJoining && onJoin(item.id)}
            disabled={isJoining}
            style={{ minWidth: 96 }}
            aria-busy={isJoining}
          >
            {isJoining ? <span className="spinner" /> : "Join"}
          </button>
        )
      ) : (
        <button
          className="btn-primary focusable"
          onClick={() => onOpen(item.id)}
        >
          Open
        </button>
      )}
    </div>
  );
}
