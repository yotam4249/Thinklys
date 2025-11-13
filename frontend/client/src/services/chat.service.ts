/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import api from "./api";
import type { ChatListItem } from "../types/chatList.type";
import type { Gender } from "../types/user.type";

/** ---------- Create ---------- */
// DM strictly by username
export async function createDmChatByUsername(username: string) {
  const { data } = await api.post("/chat/dm", { username });
  return data as {
    id: string;
    title?: string;
    type: "dm";
    lastMessageText?: string;
    lastMessageAt?: string;
    reused?: boolean;
  };
}

// Groups as before (members are user IDs if you use them)
export async function createGroupChat(title: string, members: string[] = []) {
  const { data } = await api.post("/chat/group", { title, members });
  return data as {
    id: string;
    title?: string;
    type: "group";
    lastMessageText?: string;
    lastMessageAt?: string;
    reused?: boolean;
  };
}

/** ---------- Read ---------- */
export async function getMessages(chatId: string, cursor?: string) {
  const { data } = await api.get(`/chat/${chatId}/messages`, { params: { cursor, limit: 30 } });
  return data as { items: Array<any>; nextCursor: string | null };
}

export async function listChats(page = 1, limit = 15) {
  const { data } = await api.get("/chat", { params: { page, limit } });
  return data as {
    items: ChatListItem[];
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
}

export async function joinGroup(chatId: string) {
  const { data } = await api.post(`/chat/${chatId}/join`);
  return data as { ok: boolean };
}

// export async function getChatMeta(chatId: string) {
//   const { data } = await api.get(`/chat/${chatId}`);
//   return data as {
//     id: string;
//     title?: string;
//     type: "dm" | "group";
//     members: Array<{ _id: string; username?: string; fullName?: string; name?: string; email?: string }>;
//   };
// }
export async function getChatMeta(chatId: string) {
  const { data } = await api.get(`/chat/${chatId}`);
  return data as {
    id: string;
    title?: string;
    type: "dm" | "group";
    members: Array<{
      _id: string;
      username?: string;
      fullName?: string;
      name?: string;
      email?: string;
      /** ✅ added: optional profile image key or URL */
      profileImage?: string | null;
      /** ✅ added: optional gender field */
      gender?: Gender;
    }>;
  };
}