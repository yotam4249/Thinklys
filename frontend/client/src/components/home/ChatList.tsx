import type { ChatListItem } from "../../types/chatList.type";
import { ChatItem } from "./ChatItem";
import { ChatActions } from "./ChatActions";

type Props = {
  items: ChatListItem[];
  onOpen: (id: string) => void;
  onJoin: (id: string) => void;
  joiningId: string | null;
  fmtTime: (iso?: string) => string;
};

export function ChatList({ items, onOpen, onJoin, joiningId, fmtTime }: Props) {
  return (
    <ul className="chat-list">
      {items.map((item) => (
        <ChatItem
          key={item.id}
          item={item}
          onOpen={onOpen}
          rightSlot={
            <ChatActions
              item={item}
              onOpen={onOpen}
              onJoin={onJoin}
              isJoining={joiningId === item.id}
              fmtTime={fmtTime}
            />
          }
        />
      ))}
    </ul>
  );
}
