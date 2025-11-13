/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, Socket } from "socket.io-client";
import { TokenManager } from "./api";

let socket: Socket | null = null;
let lastAuthToken: string | null = null;

function socketBaseUrl() {
  const api = import.meta.env.VITE_API_BASE as string; // "http://localhost:3000/api"
  return api.replace(/\/api\/?$/, "");                 // "http://localhost:3000"
}

/**
 * Returns a singleton socket. If the access token changed since last call,
 * it updates socket.auth and reconnects so the server sees the fresh token.
 */
export function getSocket(): Socket {
  const current = TokenManager.access ?? null;

  if (!socket) {
    socket = io(socketBaseUrl(), {
      auth: { token: current ?? undefined },
      transports: ["websocket"],
      autoConnect: true,
    });
    lastAuthToken = current;

    // Optional: helpful logs for auth-related issues
    socket.on("connect_error", (err: any) => {
      // eslint-disable-next-line no-console
      console.warn("[socket] connect_error:", err?.message ?? err);
    });

    return socket;
  }

  // Token changed after login/refresh? Re-auth & reconnect.
  if (current !== lastAuthToken) {
    (socket as any).auth = { token: current ?? undefined };
    if (socket.connected) socket.disconnect();
    socket.connect();
    lastAuthToken = current;
  }

  return socket;
}

/**
 * Manually update the socket's auth token (e.g., after login/refresh).
 * Safe to call even if socket not created yet.
 */
export function updateSocketToken(newAccess: string | null) {
  lastAuthToken = newAccess ?? null;

  if (!socket) return; // next getSocket() will create with the new token

  (socket as any).auth = { token: newAccess ?? undefined };
  if (socket.connected) socket.disconnect();
  socket.connect();
}
