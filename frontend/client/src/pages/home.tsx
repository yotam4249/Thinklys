// src/pages/home.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listChats,
  joinGroup,
  createGroupChat,
  createDmChatByUsername,
} from "../services/chat.service";
import AuthService from "../services/auth.service";

import type { ChatListItem } from "../types/chatList.type";

import { Header } from "../components/home/Header";
import { EmptyState } from "../components/home/EmptyState";
import { NewChatModal } from "../components/home/NewChatModal";
import { ErrorToast } from "../components/common/ErrorToast";
import { LogoutButton } from "../components/common/LogoutButton";
import { ProfileButton } from "../components/common/ProfileButton";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { ChatFilterTabs, type ChatFilter } from "../components/home/ChatFilterTabs";
import { ChatListPanel } from "../components/home/ChatListPanel";
import { AiAgentPanel } from "../components/ai/AiAgentPanel";

// ✅ DM dock & floating windows – rendered outside so layout stays the same
import { DmWindowsProvider } from "../components/dm/DmWindowsProvider";
import { DmDock } from "../components/dm/DmDock";
import { DmWindows } from "../components/dm/DmWindows";
import { NewDmModal } from "../components/dm/NewDmModal";
import { useDmWindows } from "../components/dm/DmWindowsProvider";

import "../styles/home.css";
import { useAppSelector, useAppDispatch } from "../store/hooks";
import { selectAuthUser } from "../store/slices/authSlice";
import { getCurrentUserThunk } from "../store/thunks/authThunk";
import { TokenManager } from "../services/api";

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "";
}

function HomeContent() {
  const navigate = useNavigate();
  const { openWindow } = useDmWindows();

  // data
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  // errors
  const [err, setErr] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  // filter (only "groups" and "discover")
  const [filter, setFilter] = useState<ChatFilter>("groups");

  // create modal
  const [showNewChat, setShowNewChat] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMembers, setNewMembers] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);

  // new DM modal
  const [showNewDm, setShowNewDm] = useState(false);
  const [creatingDm, setCreatingDm] = useState(false);
  const [newDmUsername, setNewDmUsername] = useState("");
  const [dmError, setDmError] = useState<string | null>(null);

  // joining state
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const user = useAppSelector(selectAuthUser);
  const dispatch = useAppDispatch();

  // Restore user if missing but token exists
  useEffect(() => {
    if (!user && TokenManager.access) {
      dispatch(getCurrentUserThunk());
    }
  }, [user, dispatch]);

  // load page
  const load = async (p: number) => {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await listChats(p, 15);
      setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
      setHasMore(res.hasMore);
      setPage(res.page);
    } catch (e: any) {
      setErr(e?.response?.data?.code ?? "FAILED_TO_LOAD_CHATS");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // infinite scroll
  const onHitBottom = () => {
    if (!loading && hasMore) load(page + 1);
  };
  const sentinelRef = useInfiniteScroll(onHitBottom, [page, hasMore, loading]);

  // derived lists
  const groupMember = items.filter((x) => x.type === "group" && x.isMember);
  const dms = items.filter((x) => x.type === "dm" && x.isMember !== false); // for the dock only
  const discoverGroups = items.filter((x) => x.type === "group" && !x.isMember);

  const filteredItems = filter === "groups" ? groupMember : discoverGroups;

  // actions
  const handleLogout = async () => {
    try {
      await AuthService.logout();
    } catch {
      // ignore
    } finally {
      navigate("/login");
    }
  };

  const handleCreate = async () => {
    const tokens = newMembers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!newTitle.trim()) {
      setCreateErr("TITLE_REQUIRED");
      return;
    }

    setCreating(true);
    setCreateErr(null);
    try {
      const title = newTitle.trim();
      const created = await createGroupChat(title, tokens);
      const chatId = (created as any).id ?? (created as any).chatId;
      const reused = Boolean((created as any).reused);

      const computedTitle = title || "(untitled)";
      if (!reused) {
        setItems((prev) => [
          {
            id: chatId,
            type: "group",
            title: computedTitle,
            lastMessageText: "",
            lastMessageAt: new Date().toISOString(),
            isMember: true,
          } as ChatListItem,
          ...prev,
        ]);
      }
      setNewTitle("");
      setNewMembers("");
      setShowNewChat(false);
      setFilter("groups");
      navigate(`/chat/${chatId}`, { state: { title: computedTitle } });
    } catch (e: any) {
      setCreateErr(e?.response?.data?.code ?? "FAILED_TO_CREATE_CHAT");
    } finally {
      setCreating(false);
    }
  };

  const openChat = (id: string, title?: string) => {
    navigate(`/chat/${id}`, { state: { title: title || "(untitled)" } });
  };

  const handleJoin = async (chatId: string) => {
    setJoinErr(null);
    setJoiningId(chatId);
    try {
      await joinGroup(chatId);
      setItems((prev) =>
        prev.map((it) => (it.id === chatId ? { ...it, isMember: true } : it))
      );
      const title = items.find((x) => x.id === chatId)?.title || "(untitled)";
      setFilter("groups");
      openChat(chatId, title);
    } catch (e: any) {
      setJoinErr(e?.response?.data?.code ?? "FAILED_TO_JOIN_GROUP");
    } finally {
      setJoiningId(null);
    }
  };

  const handleCreateDm = async () => {
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
      // Use username if backend returns default "(DM)" title
      const title = created.title === "(DM)" ? username : created.title || username;
      
      // Add DM to the items list if it doesn't already exist
      setItems((prev) => {
        // Check if DM already exists in the list
        const exists = prev.some((item) => item.id === chatId);
        if (exists) return prev;
        
        // Add DM to the beginning of the list
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
      // Map backend error codes to user-friendly messages
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
  };

  const counts = {
    groups: groupMember.length,
    discover: discoverGroups.length,
  };

  const count = filteredItems.length;
  const hasAnyItems = items.some((x) => x.type === "group"); // only groups matter in this panel now
  const hasFilteredItems = count > 0;

  return (
    <div className="shell">
        <LogoutButton onClick={handleLogout} />
        <ProfileButton />
        <div className="gradient-bg" />
        <div className="hello-user-fixed">
          {user ? `Hello, ${user.username}! 👋` : "Hello! 👋"}
        </div>

        {/* Two-column layout (left: chats, right: AI) */}
        <div className="home-two-col">
          <div className="card">
            <Header 
              count={count} 
              onNewChat={() => setShowNewChat(true)}
            />

            {err && <ErrorToast message={err} />}
            {joinErr && <ErrorToast message={joinErr} />}

            <ChatFilterTabs value={filter} onChange={setFilter} counts={counts} />

            {!loading && !hasFilteredItems && !err && !hasAnyItems && (
              <EmptyState onCreateClick={() => setShowNewChat(true)} />
            )}

            <ChatListPanel
              items={filteredItems}
              loading={loading}
              hasMore={hasMore}
              joiningId={joiningId}
              fmtTime={fmt}
              onOpen={(id) => {
                const t = filteredItems.find((x) => x.id === id)?.title;
                openChat(id, t);
              }}
              onJoin={handleJoin}
              onLoadMore={() => load(page + 1)}
              sentinelRef={sentinelRef}
            />
          </div>

          {/* RIGHT: AI */}
          <aside className="ai-panel-card">
            <AiAgentPanel />
          </aside>
        </div>

        <NewChatModal
          open={showNewChat}
          creating={creating}
          createErr={createErr}
          newTitle={newTitle}
          setNewTitle={setNewTitle}
          newMembers={newMembers}
          setNewMembers={setNewMembers}
          onClose={() => setShowNewChat(false)}
          onCreate={handleCreate}
        />

        <NewDmModal
          open={showNewDm}
          creating={creatingDm}
          error={dmError}
          username={newDmUsername}
          setUsername={setNewDmUsername}
          onClose={() => setShowNewDm(false)}
          onCreate={handleCreateDm}
        />

        {/* ✅ DMs live only here */}
        <DmDock 
          dms={dms} 
          loading={loading} 
          onNewDm={() => setShowNewDm(true)}
        />
        <DmWindows />
      </div>
  );
}

export default function Home() {
  return (
    <DmWindowsProvider>
      <HomeContent />
    </DmWindowsProvider>
  );
}
