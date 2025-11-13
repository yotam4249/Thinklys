import { Server as IOServer, type Socket } from "socket.io";
import type { Server as HTTPServer } from "http";
import { verifyAccess } from "../services/auth.service";
import { registerChatSocket } from "../sockets/chat.socket";
import { registerChatBroadcastConsumer } from "../consumers/chat.broadcast.consumer";

export function initSocket(server: HTTPServer) {
  const io = new IOServer(server, {
    cors: { origin: true, credentials: true },
  });

  // handshake auth
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("NO_TOKEN"));
    try {
      const p = verifyAccess(token);
      socket.data.user = { id: p.sub as string, username: p.username as string };
      next();
    } catch {
      next(new Error("INVALID_TOKEN"));
    }
  });

  // register domain-specific socket handlers
  registerChatSocket(io);
  registerChatBroadcastConsumer(io).catch((e) =>
    console.error("[KAFKA] failed to register broadcast consumer:", e)
  );

  return io;
}
