export type ChatListItem = {
  id: string;
  type: "dm" | "group";
  title: string;
  lastMessageText: string;
  lastMessageAt?: string;
  isMember?: boolean;
};
