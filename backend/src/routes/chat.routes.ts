import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { ChatController } from "../controllers/chat.controller";

export const chatRouter = Router();

// List & meta & messages
chatRouter.get("/", authMiddleware, ChatController.listChats);
chatRouter.get("/:chatId/messages", authMiddleware, ChatController.getMessages);
chatRouter.get("/:chatId", authMiddleware, ChatController.getChat);

// Creation (split endpoints; DM is username-only)
chatRouter.post("/dm", authMiddleware, ChatController.createDmChat);
chatRouter.post("/group", authMiddleware, ChatController.createGroupChat);

// Group join
chatRouter.post("/:chatId/join", authMiddleware, ChatController.joinGroup);
