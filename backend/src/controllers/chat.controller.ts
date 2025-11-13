import { Request, Response } from "express";
import mongoose from "mongoose";
import { ChatModel } from "../models/chat.model";
import { MessageModel } from "../models/message.model";
import { redis } from "../services/redis.service";
import { UserModel } from "../models/user.model"; // ⬅️ ensure this path matches your project

const OID = mongoose.Types.ObjectId;
const CACHE_TTL_SECONDS = 120;

const toIso = (v: any): string | undefined => {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
};

const computeSenderName = (u: any, fallbackId: string) =>
  u?.fullName || u?.username || u?.name || u?.email || fallbackId.slice(0, 6);

const getUserId = (u: any): string => (u?._id || u?.id || u?.userId || "").toString();

const toObjectIdSafe = (v: any): mongoose.Types.ObjectId => {
  if (v instanceof OID) return v;
  const s = String(v ?? "");
  if (!OID.isValid(s)) {
    const err: any = new Error("INVALID_OBJECT_ID");
    err.code = "INVALID_OBJECT_ID";
    throw err;
  }
  return new OID(s);
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class ChatController {
  /** -------- DM (username-only): POST /chat/dm  { username } -------- */
  static async createDmChat(req: Request, res: Response) {
    try {
      const me = getUserId(req.user);
      if (!mongoose.Types.ObjectId.isValid(me)) {
        return res.status(401).json({ code: "BAD_TOKEN_USER_ID" });
      }

      const { username } = req.body ?? {};
      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({ code: "USERNAME_REQUIRED" });
      }

      // Case-insensitive exact username match
      const other = await UserModel.findOne({
        username: { $regex: `^${escapeRegex(username.trim())}$`, $options: "i" },
      })
        .select("_id")
        .lean<{ _id: mongoose.Types.ObjectId }>();

      if (!other) return res.status(404).json({ code: "USER_NOT_FOUND" });

      const otherId = toObjectIdSafe(other._id);

      if (String(otherId) === me) {
        return res.status(400).json({ code: "CANNOT_DM_SELF" });
      }

      const pair = [toObjectIdSafe(me), otherId];

      // Reuse existing DM if exists
      const existing = await ChatModel.findOne({
        type: "dm",
        members: { $all: pair },
        $expr: { $eq: [{ $size: "$members" }, 2] },
      }).lean();

      if (existing) {
        return res.status(200).json({
          id: String(existing._id),
          title: existing.title ?? "(DM)",
          type: "dm",
          lastMessageText: existing.lastMessageText ?? "",
          lastMessageAt: toIso(existing.lastMessageAt ?? existing.updatedAt),
          reused: true,
        });
      }

      const chat = await ChatModel.create({
        type: "dm",
        title: "(DM)",
        members: pair,
      });

      // Invalidate caches for both users
      await redis.del(`u:${me}:recent_chats`);
      await redis.del(`u:${String(otherId)}:recent_chats`);

      return res.status(201).json({
        id: String(chat._id),
        title: chat.title ?? "(DM)",
        type: "dm",
        lastMessageText: chat.lastMessageText ?? "",
        lastMessageAt: toIso(chat.lastMessageAt ?? chat.updatedAt),
        reused: false,
      });
    } catch (e) {
      console.error("createDmChat error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  /** -------- Group: POST /chat/group  { title, members?: string[] } -------- */
  static async createGroupChat(req: Request, res: Response) {
    try {
      const me = getUserId(req.user);
      if (!mongoose.Types.ObjectId.isValid(me)) {
        return res.status(401).json({ code: "BAD_TOKEN_USER_ID" });
      }

      const { title, members = [] } = req.body ?? {};
      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ code: "TITLE_REQUIRED" });
      }

      let memberIds: mongoose.Types.ObjectId[];
      try {
        const unique = new Set<string>([me, ...members.map(String)]);
        memberIds = Array.from(unique).map(toObjectIdSafe);
      } catch (e: any) {
        if (e?.code === "INVALID_OBJECT_ID") {
          return res.status(400).json({ code: "INVALID_MEMBER_ID" });
        }
        throw e;
      }

      const chat = await ChatModel.create({
        title: title.trim(),
        type: "group",
        members: memberIds,
      });

      await redis.del(`u:${me}:recent_chats`);

      return res.status(201).json({
        id: String(chat._id),
        title: chat.title ?? "(untitled)",
        type: "group",
        lastMessageText: chat.lastMessageText ?? "",
        lastMessageAt: toIso(chat.lastMessageAt ?? chat.updatedAt),
        reused: false,
      });
    } catch (e) {
      console.error("createGroupChat error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  /** -------- Messages: GET /chat/:chatId/messages -------- */
  static async getMessages(req: Request, res: Response) {
    try {
      const userId = getUserId(req.user);
      const { chatId } = req.params;
      const { cursor, limit = "30" } = req.query as { cursor?: string; limit?: string };

      const chat = await ChatModel.findById(chatId).select("_id type members").lean();
      if (!chat) return res.status(404).json({ code: "CHAT_NOT_FOUND" });

      if (chat.type === "dm") {
        const isMember = (chat.members ?? []).some((m) => String(m) === userId);
        if (!isMember) return res.status(403).json({ code: "FORBIDDEN" });
      }
      // groups are public-readable

      const q: any = { chatId: toObjectIdSafe(String(chatId)) };
      if (cursor) q._id = { $lt: toObjectIdSafe(String(cursor)) };

      const pageSize = Math.min(parseInt(String(limit), 10) || 30, 100);

      const msgs = await MessageModel.find(q)
        .sort({ _id: -1 })
        .limit(pageSize)
        .populate({ path: "senderId", select: "_id username fullName name email profileImage gender" })
        .lean();

      const items = msgs.reverse().map((m: any) => {
        const senderObj = m.senderId && typeof m.senderId === "object" ? m.senderId : null;
        const senderId = String(senderObj?._id ?? m.senderId);
        const senderName = computeSenderName(senderObj, senderId);

        return {
          _id: String(m._id),
          chatId: String(m.chatId),
          senderId,
          type: m.type,
          text: m.text,
          imageUrls: m.imageUrls || [],
          createdAt: toIso(m.createdAt),
          senderName,
          senderProfileImage: senderObj?.profileImage ?? null,
          senderGender: senderObj?.gender ?? null,
        };
      });

      return res.json({
        items,
        nextCursor: msgs.length ? String(msgs[0]._id) : null,
      });
    } catch (err) {
      console.error("getMessages error:", err);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  /** -------- List: GET /chat -------- */
  private static mapItem(c: any, userId: string) {
    const isMember =
      c.type === "dm"
        ? true
        : Array.isArray(c.members) && c.members.some((m: any) => String(m) === userId);

    return {
      id: String(c._id),
      type: c.type,
      title: c.title ?? "(untitled)",
      lastMessageText: c.lastMessageText ?? "",
      lastMessageAt: toIso(c.lastMessageAt ?? c.updatedAt),
      isMember,
    };
  }

  static async listChats(req: Request, res: Response) {
    try {
      const userId = getUserId(req.user);

      let page = parseInt(String(req.query.page ?? "1"), 10);
      let limit = parseInt(String(req.query.limit ?? "15"), 10);
      if (!Number.isFinite(page) || page < 1) page = 1;
      if (!Number.isFinite(limit) || limit < 1) limit = 15;
      if (limit > 50) limit = 50;

      const cacheKey = `u:${userId}:recent_chats`;
      let recent: any[] | null = null;

      const cached = await redis.get(cacheKey);
      if (cached) {
        try {
          recent = JSON.parse(cached);
        } catch {}
      }

      if (!recent) {
        // include members so we can compute isMember for groups
        const myChats = await ChatModel.find({ members: toObjectIdSafe(String(userId)) })
          .sort({ updatedAt: -1 })
          .limit(30)
          .select("_id type title lastMessageText lastMessageAt updatedAt members")
          .lean();

        const publicGroups = await ChatModel.find({ type: "group" })
          .sort({ updatedAt: -1 })
          .limit(30)
          .select("_id type title lastMessageText lastMessageAt updatedAt members")
          .lean();

        const map = new Map<string, any>();
        for (const c of [...myChats, ...publicGroups]) {
          map.set(String(c._id), c);
        }
        recent = Array.from(map.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        await redis.set(cacheKey, JSON.stringify(recent), "EX", CACHE_TTL_SECONDS);
      }

      const start = (page - 1) * limit;
      const end = start + limit;

      if (end <= 30) {
        const slice = recent.slice(start, end).map((c) => ChatController.mapItem(c, userId));
        return res.json({
          items: slice,
          page,
          pageSize: limit,
          hasMore: recent.length > end,
        });
      }

      // deep pages (no cache)
      const myChatsAll = await ChatModel.find({ members: toObjectIdSafe(String(userId)) })
        .sort({ updatedAt: -1 })
        .select("_id type title lastMessageText lastMessageAt updatedAt members")
        .lean();

      const publicGroupsAll = await ChatModel.find({ type: "group" })
        .sort({ updatedAt: -1 })
        .select("_id type title lastMessageText lastMessageAt updatedAt members")
        .lean();

      const allMap = new Map<string, any>();
      for (const c of [...myChatsAll, ...publicGroupsAll]) {
        allMap.set(String(c._id), c);
      }
      const all = Array.from(allMap.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      const pageItems = all.slice(start, end);

      return res.json({
        items: pageItems.map((c) => ChatController.mapItem(c, userId)),
        page,
        pageSize: limit,
        hasMore: end < all.length,
      });
    } catch (e) {
      console.error("listChats error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  /** -------- Group join: POST /chat/:chatId/join -------- */
  static async joinGroup(req: Request, res: Response) {
    try {
      const userId = getUserId(req.user);
      const { chatId } = req.params;

      const chat = await ChatModel.findById(chatId).select("_id type members");
      if (!chat) return res.status(404).json({ code: "CHAT_NOT_FOUND" });
      if (chat.type !== "group") return res.status(400).json({ code: "NOT_A_GROUP" });

      const already = chat.members.some((m) => String(m) === userId);
      if (!already) {
        chat.members.push(toObjectIdSafe(String(userId)));
        await chat.save();
        await redis.del(`u:${userId}:recent_chats`);
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("joinGroup error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  /** -------- Chat meta: GET /chat/:chatId -------- */
  static async getChat(req: Request, res: Response) {
    try {
      const userId = getUserId(req.user);
      const { chatId } = req.params;

      const chat = await ChatModel.findById(chatId)
        .populate({ path: "members", select: "_id username fullName name email profileImage gender" })
        .lean();

      if (!chat) return res.status(404).json({ code: "CHAT_NOT_FOUND" });

      // Privacy: DM meta only for members; groups are public
      if (chat.type === "dm") {
        const isMember = (chat.members ?? []).some((m: any) => String(m._id) === userId);
        if (!isMember) return res.status(403).json({ code: "FORBIDDEN" });
      }

      return res.json({
        id: String(chat._id),
        title: chat.title ?? "(untitled)",
        type: chat.type,
        members: (chat.members ?? []).map((u: any) => ({
          _id: String(u._id),
          username: u.username,
          fullName: u.fullName,
          name: u.name,
          email: u.email,
          profileImage: u.profileImage ?? null,   // S3 key or full URL
          gender: u.gender ?? null,   
        })),
      });
    } catch (e) {
      console.error("getChat error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }
}
