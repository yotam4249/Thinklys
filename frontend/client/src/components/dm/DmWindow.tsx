// src/components/dm/DmWindow.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState,type MouseEvent } from "react";
import { useDmWindows } from "./DmWindowsProvider";
import { getMessages, getChatMeta } from "../../services/chat.service";
import { getSocket } from "../../services/socket.service";
import type { ChatMessage } from "../../types/chat.type";
import { TokenManager } from "../../services/api";
import "../../styles/dm.css";

type Props = {
  chatId: string;
  title: string;
  index: number; // stacking offset/index
};

const DEBUG_DM = false;
const log = (...a: any[]) => DEBUG_DM && console.log("[DM]", ...a);

function uuid() {
  return (crypto as any)?.randomUUID?.() ?? "tmp-" + Math.random().toString(36).slice(2);
}

// Decode user id from current access token
function decodeUserIdFromJWT(jwt?: string | null): string | null {
  try {
    if (!jwt) return null;
    const [, payload] = jwt.split(".");
    const json = JSON.parse(atob(payload));
    return json._id || json.userId || json.sub || null;
  } catch {
    return null;
  }
}

export function DmWindow({ chatId, title, index }: Props) {
  const { closeWindow, minimizeWindow, bringToFront, windows } = useDmWindows();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pendingEchos = useRef<Record<string, number>>({}); // clientId -> timestamp
  const [displayTitle, setDisplayTitle] = useState(title);

  const myId = useMemo(() => decodeUserIdFromJWT(TokenManager.access ?? null), []);

  const minimized = useMemo(
    () => windows.find((w) => w.chatId === chatId)?.minimized ?? false,
    [windows, chatId]
  );

  const scrollToBottom = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const normalize = (m: any): ChatMessage => ({
    _id: String(m._id ?? m.id ?? uuid()),
    chatId: String(m.chatId ?? chatId),
    senderId: String(m.senderId ?? m.sender?._id ?? ""),
    text: String(m.text ?? m.content ?? ""),
    createdAt: m.createdAt ?? m.timestamp ?? new Date().toISOString(),
  });

  // Resolve peer name if title is "(DM)" or default
  useEffect(() => {
    if ((title === "(DM)" || !title || title.trim() === "") && myId) {
      (async () => {
        try {
          const meta = await getChatMeta(chatId);
          const members = Array.isArray(meta?.members) ? meta.members : [];
          const peer =
            members.find((m: any) => m?._id !== myId) ??
            members[0] ??
            null;

          if (peer) {
            const peerName =
              peer?.username || peer?.fullName || peer?.name || peer?.email || title;
            setDisplayTitle(peerName);
          } else {
            setDisplayTitle(title);
          }
        } catch (err) {
          console.error("Failed to resolve peer name for DM:", err);
          setDisplayTitle(title);
        }
      })();
    } else {
      setDisplayTitle(title);
    }
  }, [chatId, title, myId]);

  useEffect(() => {
    log("DmWindow mount", { chatId, title, index });

    (async () => {
      try {
        setLoading(true);
        const res = await getMessages(chatId);
        const list = Array.isArray(res) ? res : (res.items ?? []);
        setMsgs(list.slice(-30).map(normalize));
      } finally {
        setLoading(false);
        setTimeout(scrollToBottom, 0);
      }
    })();

    const s = getSocket();

    const onConnect = () => log("socket: connect", { id: s.id });
    const onDisconnect = (reason: any) => log("socket: disconnect", { reason });
    const onConnectError = (err: any) => log("socket: connect_error", err?.message ?? err);
    const onError = (err: any) => log("socket: error", err);

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);
    s.on("error", onError);

    // join this chat room
    s.emit?.("chat:join", { chatId });

    const onMessageNew = (payload: any) => {
      const p = { chatId, ...payload };
      if (String(p.chatId) !== String(chatId)) return;
      const incoming = normalize(p);

      setMsgs((prev) => {
        // reconcile with last optimistic message that has same text (optional)
        const revIdx = [...prev].reverse().findIndex((m) => m.pending && m.text === incoming.text);
        if (revIdx !== -1) {
          const realIndex = prev.length - 1 - revIdx;
          const copy = prev.slice();
          copy[realIndex] = { ...incoming, pending: false, clientId: undefined };
          return copy;
        }
        return [...prev, incoming];
      });

      setTimeout(scrollToBottom, 0);
    };

    s.on?.("message:new", onMessageNew);

    return () => {
      s.off?.("message:new", onMessageNew);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
      s.off("error", onError);
      s.emit?.("chat:leave", { chatId });
    };
  }, [chatId]);

  /** Bring to front ONLY when clicking the header (not body/composer/actions) */
  const onHeaderMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".dmw-actions")) return;
    bringToFront(chatId);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    const clientId = uuid();

    // optimistic (mark as mine via senderId === "me")
    const optimistic: ChatMessage = {
      _id: clientId,
      chatId,
      senderId: "me",
      text,
      createdAt: new Date().toISOString(),
      pending: true,
      clientId,
    };
    setMsgs((prev) => [...prev, optimistic]);
    setInput("");
    setTimeout(scrollToBottom, 0);

    try {
      const s = getSocket();
      s.emit?.("message:send", { chatId, text });

      pendingEchos.current[clientId] = Date.now();
      setTimeout(() => {
        if (pendingEchos.current[clientId]) {
          log("no message:new echo after 4s", { clientId, chatId, text });
        }
      }, 4000);
    } finally {
      setSending(false);
    }
  };

  const isMine = (m: ChatMessage) => m.senderId === "me" || (myId && m.senderId === myId);

  return (
    <div
      className={`dm-window ${minimized ? "min" : ""}`}
      style={{ right: 20 + index * 320 }}
    >
      <div
        className="dmw-header"
        onMouseDown={onHeaderMouseDown}
        onDoubleClick={() => minimizeWindow(chatId, !minimized)}
      >
        <div className="dmw-title" title={displayTitle}>
          {displayTitle || "(DM)"}
        </div>

        <div className="dmw-actions">
          <button
            type="button"
            aria-label={minimized ? "Restore" : "Minimize"}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              minimizeWindow(chatId, !minimized);
            }}
          >
            {minimized ? "▢" : "—"}
          </button>

          <button
            type="button"
            aria-label="Close"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              closeWindow(chatId);
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="dmw-body" ref={scrollerRef}>
            {loading && <div className="dmw-loading">Loading…</div>}
            {!loading && msgs.length === 0 && <div className="dmw-empty">Say hi 👋</div>}
            {msgs.map((m) => (
              <div
                key={m._id}
                className={`dmw-msg ${isMine(m) ? "mine" : "theirs"} ${m.pending ? "ghost" : ""}`}
              >
                <div className="dmw-bubble">
                  <div className="dmw-text">{m.text}</div>
                  <div className="dmw-time">
                    {new Date(m.createdAt ?? Date.now()).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="dmw-composer">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder="Type a message…"
              disabled={sending}
            />
            <button onClick={send} disabled={sending || !input.trim()}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
