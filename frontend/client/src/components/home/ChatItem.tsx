/* eslint-disable @typescript-eslint/no-unused-vars */
import { type ReactNode } from "react";
import avatarIcon from "../../assets/avatar.svg";
import groupIcon from "../../assets/group.svg";
import type { ChatListItem } from "../../types/chatList.type";

type Props = {
  item: ChatListItem;
  onOpen: (id: string) => void;   // still used by the action buttons
  rightSlot?: ReactNode;
};

export function ChatItem({ item, onOpen, rightSlot }: Props) {
  const isGroup = item.type === "group";
  const badgeIcon = isGroup ? groupIcon : avatarIcon;
  const badgeLabel = isGroup ? "Group" : "DM";

  return (
    <li className="list-item chat-item one-line" role="listitem">
      {/* Avatar */}
      <img
        src={avatarIcon}
        alt="avatar"
        className="avatar-img"
        width={34}
        height={34}
      />

      {/* Single-line info */}
      <div className="chat-info chat-inline" title={item.lastMessageText || ""}>
        <span className="chat-title ellipsis">{item.title || "(untitled)"}</span>

        <span className="title-separator" aria-hidden></span>

        <span className={`badge inline ${isGroup ? "group" : "dm"}`}>
          <img
            src={badgeIcon}
            alt={badgeLabel}
            width={14}
            height={14}
            className="badge-icon"
          />
          <span className="badge-label">{badgeLabel}</span>
        </span>

        <span className="dot-sep" aria-hidden>•</span>

        <span className="chat-preview ellipsis">
          {item.lastMessageText 
            ? (item.lastMessageText.length > 20 
                ? item.lastMessageText.substring(0, 20) + "..." 
                : item.lastMessageText)
            : "No messages yet"}
        </span>
      </div>

      {/* Right side (time + Join/Enter/Open buttons) */}
      {rightSlot}
    </li>
  );
}
