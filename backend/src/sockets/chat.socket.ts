// src/sockets/chat.socket.ts
import type { Server, Socket } from "socket.io";
import { ChatModel } from "../models/chat.model";
import { redis } from "../services/redis.service";
import { newRequestId, publish, Topics } from "../services/kafka.service";

function roomId(chatId: string) {
  return `chat:${chatId}`;
}

export function registerChatSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as { id: string; username: string } | undefined;
    if (!user) return;

    socket.on("chat:join", async ({ chatId }: { chatId: string }) => {
      const chat = await ChatModel.findById(chatId).select("_id members");
      if (!chat) return;
      if (!chat.members.some((m) => String(m) === user.id)) return;
      socket.join(roomId(chatId));
    });

    socket.on("chat:leave", ({ chatId }: { chatId: string }) => {
      socket.leave(roomId(chatId));
    });

    socket.on("message:send", async ({ chatId, text, imageUrls, type }: {
      chatId: string;
      text?: string;
      imageUrls?: string[];
      type?: "text" | "image";
    }) => {
      const clean = text ? (text ?? "").trim() : "";
      const images = imageUrls && Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
      if (!clean && images.length === 0) return;

      const chat = await ChatModel.findById(chatId).select("_id members");
      if (!chat) return;
      if (!chat.members.some((m) => String(m) === user.id)) return;

      const requestId = newRequestId();
      await publish(
        Topics.ChatMessageRequested,
        {
          requestId,
          chatId: String(chatId),
          senderId: String(user.id),
          type: type || (images.length ? "image" : "text"),
          text: clean || undefined,
          imageUrls: images.length ? images : undefined,
          clientTs: Date.now(),
        },
        String(chatId) // partitioning key
      );

      socket.emit("message:queued", { requestId, chatId });

      await redis.del(`u:${String(user.id)}:recent_chats`);
    });
  });
}
