/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatListItem } from "../../types/chatList.type";
import type { Gender } from "../../types/user.type";
import { useDmWindows } from "./DmWindowsProvider";
import { getChatMeta } from "../../services/chat.service";
import { TokenManager } from "../../services/api";
import { getSocket } from "../../services/socket.service";
import { presignGet } from "../../services/s3.service";
import "../../styles/dm.css";

// Fallback avatars
import maleAvatar from "../../assets/male.svg";
import femaleAvatar from "../../assets/female.svg";
import neutralAvatar from "../../assets/neutral.svg";

type Props = {
  dms: ChatListItem[];
  loading?: boolean;
  className?: string;
  onNewDm?: () => void;
};

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

type AvatarInfo = {
  src: string;               // final URL used by <img>
  key?: string | null;       // S3 object key (if any)
  gender?: Gender | null;    // for fallbacks
};

const genderFallback = (gender?: Gender | null) => {
  const g = (gender ?? "other").toString().toLowerCase();
  if (g === "male") return maleAvatar;
  if (g === "female") return femaleAvatar;
  // other / prefer_not_to_say / unknown
  return neutralAvatar;
};

export function DmDock({ dms, loading, className, onNewDm }: Props) {
  const { openWindow } = useDmWindows();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  // Resolved peer names & avatars by chatId
  const [peerNameByChat, setPeerNameByChat] = useState<Record<string, string>>({});
  const [peerAvatarByChat, setPeerAvatarByChat] = useState<Record<string, AvatarInfo>>({});

  // Prevent repeated concurrent fetches
  const fetchingMeta = useRef<Set<string>>(new Set());
  const refreshingAvatar = useRef<Set<string>>(new Set());

  // Realtime overlays
  const [lastByChat, setLastByChat] = useState<Record<string, { text: string; at?: string }>>({});
  const [unseenByChat, setUnseenByChat] = useState<Record<string, number>>({});
  const joinedRooms = useRef<Set<string>>(new Set());

  const currentUserId = useMemo(
    () => decodeUserIdFromJWT(TokenManager.access ?? null),
    []
  );

  // Layout offsets when dock opens/closes
  useEffect(() => {
    const root = document.documentElement;
    const offsetWhenOpen = 280 + 24;
    const offsetWhenClosed = 48;
    const offset = open ? `${offsetWhenOpen}px` : `${offsetWhenClosed}px`;
    root.style.setProperty("--dm-dock-offset", offset);
    root.style.setProperty("--dm-dock-padding", offset);
    return () => {
      root.style.setProperty("--dm-dock-offset", `${offsetWhenClosed}px`);
      root.style.setProperty("--dm-dock-padding", `${offsetWhenClosed}px`);
    };
  }, [open]);

  // ---------- Resolve peer name + avatar ----------
  useEffect(() => {
    if (!currentUserId) return;

    const dmIds = dms.filter((x) => x.type === "dm").map((x) => x.id);
    const toFetch = dmIds.filter(
      (id) => (!peerNameByChat[id] || !peerAvatarByChat[id]) && !fetchingMeta.current.has(id)
    );
    if (toFetch.length === 0) return;

    const batch = toFetch.slice(0, 6);
    batch.forEach(async (chatId) => {
      try {
        fetchingMeta.current.add(chatId);
        console.log(`--- Resolving chat ${chatId} ---`);

        const meta = await getChatMeta(chatId);
        console.log("Meta:", meta);

        const members = Array.isArray(meta?.members) ? meta.members : [];
        const peer =
          members.find((m: any) => m?._id !== currentUserId) ??
          members[0] ??
          null;

        if (!peer) {
          console.log("No peer found for chat:", chatId);
          return;
        }

        // 1) Name
        const label =
          peer?.username || peer?.fullName || peer?.name || peer?.email || "(DM)";
        setPeerNameByChat((prev) => ({ ...prev, [chatId]: label }));
        console.log("Peer label:", label);

        // 2) Avatar policy:
        //    If profileImage exists → presign and use returned URL
        //    else → use gender fallback (male/female/neutral)
        const raw: string | null = peer?.profileImage ?? null;
        const gender: Gender | null = (peer?.gender as Gender) ?? null;

        console.log("Profile image:", raw, "Gender:", gender);

        if (raw && /^https?:\/\//i.test(raw)) {
          // If your backend ever returns a direct URL
          console.log("Using direct URL for avatar");
          setPeerAvatarByChat((prev) => ({
            ...prev,
            [chatId]: { src: raw, key: null, gender },
          }));
        } else if (raw && typeof raw === "string") {
          // S3 key → presign
          console.log("Presigning S3 key:", raw);
          try {
            const url = await presignGet(raw);
            console.log("Presign success:", url);
            setPeerAvatarByChat((prev) => ({
              ...prev,
              [chatId]: { src: url, key: raw, gender },
            }));
          } catch (err) {
            console.error("Presign failed; using fallback:", err);
            setPeerAvatarByChat((prev) => ({
              ...prev,
              [chatId]: { src: genderFallback(gender), key: raw, gender },
            }));
          }
        } else {
          // No image set → fallback
          console.log("No image; using gender fallback");
          setPeerAvatarByChat((prev) => ({
            ...prev,
            [chatId]: { src: genderFallback(gender), key: null, gender },
          }));
        }
      } catch (err) {
        console.error("Error fetching meta for chat:", chatId, err);
      } finally {
        fetchingMeta.current.delete(chatId);
      }
    });
  }, [dms, currentUserId, peerNameByChat, peerAvatarByChat]);

  // ---------- Join/leave rooms + message listener ----------
  useEffect(() => {
    const s = getSocket();
    const dmIds = dms.filter((x) => x.type === "dm").map((x) => x.id);
    const nextSet = new Set(dmIds);

    for (const id of dmIds) {
      if (!joinedRooms.current.has(id)) {
        console.log("Joining DM room:", id);
        s.emit?.("chat:join", { chatId: id });
        joinedRooms.current.add(id);
      }
    }
    for (const id of Array.from(joinedRooms.current)) {
      if (!nextSet.has(id)) {
        console.log("Leaving DM room:", id);
        s.emit?.("chat:leave", { chatId: id });
        joinedRooms.current.delete(id);
      }
    }

    const onMessageNew = (payload: any) => {
      const chatId = String(payload?.chatId ?? "");
      const text = String(payload?.text ?? payload?.content ?? "");
      const from = String(payload?.senderId ?? "");
      console.log("New message:", { chatId, from, text });
      if (!nextSet.has(chatId)) return;

      setLastByChat((prev) => ({ ...prev, [chatId]: { text, at: payload?.createdAt } }));

      setUnseenByChat((prev) => {
        if (from && currentUserId && from === currentUserId) {
          if (!prev[chatId]) return prev;
          const { [chatId]: _, ...rest } = prev;
          return rest;
        }
        const next = (prev[chatId] ?? 0) + 1;
        return { ...prev, [chatId]: next };
      });
    };

    s.on?.("message:new", onMessageNew);
    return () => {
      s.off?.("message:new", onMessageNew);
    };
  }, [dms, currentUserId]);

  // ---------- Build display list ----------
  const withDisplay = useMemo(() => {
    return dms.map((it) => {
      if (it.type !== "dm") return it;
      const title = peerNameByChat[it.id] || it.title || "(DM)";
      const overlayText = lastByChat[it.id]?.text;
      return {
        ...it,
        title,
        lastMessageText: overlayText ?? it.lastMessageText ?? "",
      };
    });
  }, [dms, peerNameByChat, lastByChat]);

  const filtered = useMemo(() => {
    if (!q.trim()) return withDisplay;
    const s = q.trim().toLowerCase();
    return withDisplay.filter((x) => (x.title || "").toLowerCase().includes(s));
  }, [withDisplay, q]);

  // Open DM and clear unseen
  const handleOpen = (chatId: string, title?: string) => {
    console.log("Opening DM:", chatId);
    setUnseenByChat((prev) => {
      if (!prev[chatId]) return prev;
      const { [chatId]: _, ...rest } = prev;
      return rest;
    });
    openWindow({ chatId, title: title || "(DM)" });
  };

  // If presigned URL expires → re-presign once, else fallback to gender avatar
  const handleAvatarError = async (chatId: string) => {
    const info = peerAvatarByChat[chatId];
    console.log("Image load error for chat:", chatId, info);

    if (!info?.key) {
      console.log("No key to refresh; using gender fallback");
      setPeerAvatarByChat((prev) => ({
        ...prev,
        [chatId]: { ...info, src: genderFallback(info?.gender) },
      }));
      return;
    }

    if (refreshingAvatar.current.has(chatId)) {
      console.log("Already refreshing this avatar; skipping");
      return;
    }

    try {
      refreshingAvatar.current.add(chatId);
      console.log("Re-presigning avatar:", info.key);
      const fresh = await presignGet(info.key);
      console.log("Re-presign success:", fresh);
      setPeerAvatarByChat((prev) => ({ ...prev, [chatId]: { ...info, src: fresh } }));
    } catch (err) {
      console.error("Re-presign failed; using fallback:", err);
      setPeerAvatarByChat((prev) => ({
        ...prev,
        [chatId]: { ...info, src: genderFallback(info.gender) },
      }));
    } finally {
      setTimeout(() => refreshingAvatar.current.delete(chatId), 4000);
    }
  };

  return (
    <aside className={`dm-dock ${open ? "open" : "closed"} ${className ?? ""}`}>
      <button className="dm-dock-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "‹" : "›"}
      </button>

      {open && (
        <>
          <div className="dm-dock-header">
            <div className="dm-dock-header-title-row">
              <h3>Direct Messages</h3>
              {onNewDm && (
                <button
                  className="dm-add-button"
                  onClick={onNewDm}
                  title="New DM"
                  aria-label="Create new direct message"
                >
                  +
                </button>
              )}
            </div>
            <input
              className="dm-search"
              placeholder="Search DM…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="dm-list">
            {loading && dms.length === 0 && <div className="dm-empty">Loading…</div>}
            {!loading && filtered.length === 0 && <div className="dm-empty">No DMs</div>}

            {filtered.map((it) => {
              const unseen = unseenByChat[it.id] ?? 0;
              const preview = (it.lastMessageText || "").slice(0, 36);
              const hasMore = (it.lastMessageText || "").length > 36;
              const avatar = peerAvatarByChat[it.id]?.src ?? neutralAvatar;

              return (
                <button
                  key={it.id}
                  className={`dm-item ${unseen ? "has-unseen" : ""}`}
                  onClick={() => handleOpen(it.id, it.title)}
                  title={it.title || "(DM)"}
                >
                  <div className="dm-avatar" aria-hidden>
                    <img
                      className="dm-avatar-img"
                      src={avatar}
                      alt=""
                      onError={() => handleAvatarError(it.id)}
                      decoding="async"
                      loading="lazy"
                    />
                  </div>

                  <div className="dm-meta">
                    <div className="dm-title-row">
                      <div className="dm-title">{it.title || "(DM)"}</div>
                      {unseen > 0 && (
                        <span className="dm-unseen-dot" aria-label={`${unseen} new`}>
                          {unseen > 9 ? "9+" : unseen}
                        </span>
                      )}
                    </div>
                    {it.lastMessageText && (
                      <div className="dm-sub">
                        {preview}
                        {hasMore ? "…" : ""}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
