/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getMessages, getChatMeta, listChats } from "../services/chat.service";
import { getSocket } from "../services/socket.service";
import { TokenManager } from "../services/api";
import { ChatHeader } from "../components/chat/ChatHeader";
import { MessageList } from "../components/chat/MessageList";
import { Composer } from "../components/chat/Composer";
import { AiAgentPanel } from "../components/ai/AiAgentPanel";
import { DmWindowsProvider, useDmWindows } from "../components/dm/DmWindowsProvider";
import { DmDock } from "../components/dm/DmDock";
import { DmWindows } from "../components/dm/DmWindows";
import { NewDmModal } from "../components/dm/NewDmModal";
import type { ChatMessage } from "../types/chat.type";
import type { ChatListItem } from "../types/chatList.type";
import { useAppSelector } from "../store/hooks";
import { selectAuthUser } from "../store/slices/authSlice";
import { createDmChatByUsername } from "../services/chat.service";
import "../styles/chat.css";

function decodeUserIdFromJWT(jwt?: string | null): string | null {
  try {
    if (!jwt) return null;
    const [, payload] = jwt.split(".");
    const json = JSON.parse(atob(payload));
    return json._id || json.id || json.userId || json.sub || null;
  } catch {
    return null;
  }
}

function uuid() {
  return (crypto as any)?.randomUUID?.() ?? "tmp-" + Math.random().toString(36).slice(2);
}

type RouteState = { title?: string } | null;
type MsgWithName = ChatMessage & { senderName?: string };

function ChatPageContent({ chatId }: { chatId: string }) {
  const meId = useMemo(() => decodeUserIdFromJWT(TokenManager.access) || "me", []);
  const currentUser = useAppSelector(selectAuthUser);
  const location = useLocation();
  const routeState = (location.state as RouteState) || null;
  const chatTitleFromNav = routeState?.title || "(untitled)";
  const { openWindow } = useDmWindows();

  const [messages, setMessages] = useState<MsgWithName[]>([]);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState(chatTitleFromNav);
  const [nameById, setNameById] = useState<Record<string, string>>({});

  // DM data for dock
  const [dms, setDms] = useState<ChatListItem[]>([]);
  const [dmsLoading, setDmsLoading] = useState(false);

  // New DM modal state
  const [showNewDm, setShowNewDm] = useState(false);
  const [creatingDm, setCreatingDm] = useState(false);
  const [newDmUsername, setNewDmUsername] = useState("");
  const [dmError, setDmError] = useState<string | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const msgsRef = useRef<MsgWithName[]>([]);
  msgsRef.current = messages;

  const sendTimerRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const pickDisplayName = (u: any, fallbackId: string) =>
    u?.fullName || u?.username || u?.name || u?.email || fallbackId.slice(0, 6);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meta = await getChatMeta(chatId);
        if (cancelled) return;
        setTitle(meta.title ?? chatTitleFromNav);

        const map: Record<string, string> = {};
        for (const m of meta.members || []) {
          if (m?._id) map[m._id] = pickDisplayName(m, m._id);
        }
        setNameById(map);
      } catch {
        // ignore
      }

      try {
        const data = await getMessages(chatId);
        if (cancelled) return;

        data.items.forEach((m: any) => m._id && seenIdsRef.current.add(String(m._id)));

        setMessages(
          data.items.map((m: any) => ({
            _id: String(m._id),
            chatId: String(m.chatId),
            senderId: String(m.senderId),
            type: m.type || "text",
            text: m.text ? String(m.text) : undefined,
            imageUrls: m.imageUrls || undefined,
            createdAt:
              typeof m.createdAt === "string"
                ? m.createdAt
                : new Date(m.createdAt ?? Date.now()).toISOString(),
            pending: false,
            senderName: m.senderName ?? nameById[String(m.senderId)],
            senderProfileImage: m.senderProfileImage ?? null,
            senderGender: m.senderGender ?? null,
          }))
        );
      } catch {
        setMessages([]);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    if (!Object.keys(nameById).length || !messages.length) return;
    setMessages((prev) =>
      prev.map((m) => (m.senderName ? m : { ...m, senderName: nameById[m.senderId] }))
    );
  }, [nameById, messages.length]);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("chat:join", { chatId });

    const onNew = (raw: any) => {
      const m: MsgWithName = {
        _id: String(raw._id),
        chatId: String(raw.chatId),
        senderId: String(raw.senderId),
        type: raw.type || "text",
        text: raw.text ? String(raw.text) : undefined,
        imageUrls: raw.imageUrls || undefined,
        createdAt:
          typeof raw.createdAt === "string"
            ? raw.createdAt
            : new Date(raw.createdAt ?? Date.now()).toISOString(),
        pending: false,
        senderName: raw.senderName ?? nameById[String(raw.senderId)],
        senderProfileImage: raw.senderProfileImage ?? null,
        senderGender: raw.senderGender ?? null,
      };

      if (m.chatId !== chatId) return;
      if (m._id && seenIdsRef.current.has(m._id)) return;

      setMessages((prev) => {
        const echoedAt = new Date(m.createdAt ?? Date.now()).getTime();
        const rev = [...prev].reverse();
        const jRev = rev.findIndex(
          (x) =>
            x.pending &&
            x.senderId === meId &&
            x.text === m.text &&
            JSON.stringify(x.imageUrls || []) === JSON.stringify(m.imageUrls || []) &&
            Math.abs(echoedAt - new Date(x.createdAt ?? Date.now()).getTime()) < 60_000
        );

        if (jRev !== -1) {
          const j = prev.length - 1 - jRev;
          const next = prev.slice();
          next[j] = { ...m, pending: false };
          if (m._id) seenIdsRef.current.add(m._id);
          if (sendTimerRef.current) {
            window.clearTimeout(sendTimerRef.current);
            sendTimerRef.current = null;
          }
          setSending(false);
          return next;
        }

        if (m._id && prev.some((x) => x._id === m._id)) return prev;
        if (m._id) seenIdsRef.current.add(m._id);
        return prev.concat(m);
      });
    };

    socket.on("message:new", onNew);

    return () => {
      socket.emit("chat:leave", { chatId });
      socket.off("message:new", onNew);
    };
  }, [chatId, meId, nameById]);

  const send = (text: string, imageUrls?: string[]) => {
    const clean = text ? text.trim() : "";
    const images = imageUrls || [];
    
    // Must have either text or images
    if (!clean && images.length === 0) return;

    const clientId = uuid();
    const msgType = images.length > 0 ? (clean ? "text" : "image") : "text";
    const optimistic: MsgWithName = {
      _id: clientId,
      clientId,
      chatId,
      senderId: meId,
      type: msgType,
      text: clean || undefined,
      imageUrls: images.length > 0 ? images : undefined,
      createdAt: new Date().toISOString(),
      pending: true,
      senderName: nameById[meId] ?? "You",
      senderProfileImage: currentUser?.profileImage ?? null,
      senderGender: currentUser?.gender ?? null,
    };

    setSending(true);
    setMessages((prev) => prev.concat(optimistic));

    if (sendTimerRef.current) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    sendTimerRef.current = window.setTimeout(() => {
      setSending(false);
      sendTimerRef.current = null;
    }, 4000);

    getSocket().emit(
      "message:send",
      { 
        chatId, 
        text: clean || undefined, 
        imageUrls: images.length > 0 ? images : undefined,
        type: msgType,
        clientId 
      },
      (_ack?: { ok: boolean }) => {
        if (sendTimerRef.current) {
          window.clearTimeout(sendTimerRef.current);
          sendTimerRef.current = null;
        }
        setSending(false);
      }
    );
  };

  useEffect(() => {
    return () => {
      if (sendTimerRef.current) {
        window.clearTimeout(sendTimerRef.current);
        sendTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // Fetch DMs for dock
  useEffect(() => {
    let cancelled = false;
    setDmsLoading(true);
    
    (async () => {
      try {
        const res = await listChats(1, 100); // Get enough to cover all DMs
        if (cancelled) return;
        const dmList = res.items.filter((x) => x.type === "dm" && x.isMember !== false);
        setDms(dmList);
      } catch {
        if (!cancelled) setDms([]);
      } finally {
        if (!cancelled) setDmsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="chat-shell" role="main" aria-label="Chat interface">
        <div className="chat-card">
          {/* LEFT COLUMN - Main Chat Area */}
          <div className="chat-main">
            <ChatHeader chatId={chatId} title={title} />

            <div className="messages-wrapper">
              <MessageList messages={messages} meId={meId} onSend={send} />
              <div ref={bottomRef} aria-hidden="true" className="messages-anchor" />
            </div>

            <div className="composer-wrapper">
              <Composer disabled={sending} onSend={send} />
            </div>
          </div>

          {/* RIGHT COLUMN - AI Assistant Sidebar */}
          <aside className="chat-aside" aria-label="AI Teaching Assistant">
            <AiAgentPanel 
              chatId={chatId}
              onShareQuiz={(quizText) => send(quizText)}
            />
          </aside>
        </div>
      </div>

      {/* DM Dock and Floating Windows */}
      <DmDock 
        dms={dms} 
        loading={dmsLoading}
        onNewDm={() => setShowNewDm(true)}
      />
      <DmWindows />

      {/* New DM Modal */}
      <NewDmModal
        open={showNewDm}
        creating={creatingDm}
        error={dmError}
        username={newDmUsername}
        setUsername={setNewDmUsername}
        onClose={() => {
          setShowNewDm(false);
          setDmError(null);
          setNewDmUsername("");
        }}
        onCreate={async () => {
          const username = newDmUsername.trim();
          if (!username) {
            setDmError("USERNAME_REQUIRED");
            return;
          }

          setCreatingDm(true);
          setDmError(null);
          try {
            const created = await createDmChatByUsername(username);
            const chatId = created.id;
            const title = created.title === "(DM)" ? username : created.title || username;
            
            // Add DM to the items list if it doesn't already exist
            setDms((prev) => {
              const exists = prev.some((item) => item.id === chatId);
              if (exists) return prev;
              
              return [
                {
                  id: chatId,
                  type: "dm" as const,
                  title: title,
                  lastMessageText: created.lastMessageText || "",
                  lastMessageAt: created.lastMessageAt || new Date().toISOString(),
                  isMember: true,
                } as ChatListItem,
                ...prev,
              ];
            });
            
            setNewDmUsername("");
            setShowNewDm(false);
            openWindow({ chatId, title });
          } catch (e: any) {
            const errorCode = e?.response?.data?.code;
            if (errorCode === "USER_NOT_FOUND") {
              setDmError("User not found. Please check the username and try again.");
            } else if (errorCode === "CANNOT_DM_SELF") {
              setDmError("You cannot send a direct message to yourself.");
            } else if (errorCode === "USERNAME_REQUIRED") {
              setDmError("Please enter a username.");
            } else {
              setDmError(errorCode || "Failed to create direct message. Please try again.");
            }
          } finally {
            setCreatingDm(false);
          }
        }}
      />
    </>
  );
}

export default function ChatPage({ chatId }: { chatId: string }) {
  return (
    <DmWindowsProvider>
      <ChatPageContent chatId={chatId} />
    </DmWindowsProvider>
  );
}
