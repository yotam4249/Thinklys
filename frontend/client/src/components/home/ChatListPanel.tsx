import React, { type RefObject } from "react";
import type { ChatListItem } from "../../types/chatList.type";
import { ChatList } from "./ChatList";
import { LoadMore } from "../common/LoadMore";
import { SkeletonList } from "./SkeletonList";

type Props = {
  items: ChatListItem[];
  loading: boolean;
  hasMore: boolean;
  joiningId: string | null;
  fmtTime: (iso?: string) => string;
  onOpen: (id: string) => void;
  onJoin: (chatId: string) => Promise<void>;
  onLoadMore: () => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
};

export function ChatListPanel({
  items,
  loading,
  hasMore,
  joiningId,
  fmtTime,
  onOpen,
  onJoin,
  onLoadMore,
  sentinelRef,
}: Props) {
  const hasItems = items.length > 0;

  return (
    <div className="card-body">
      {loading && !hasItems ? (
        <SkeletonList rows={6} />
      ) : (
        <ChatList
          items={items}
          onOpen={onOpen}
          onJoin={onJoin}
          joiningId={joiningId}
          fmtTime={fmtTime}
        />
      )}

      {hasMore && (
        <LoadMore onClick={onLoadMore} loading={loading} />
      )}

      <div ref={sentinelRef} className="sentinel" />
    </div>
  );
}
