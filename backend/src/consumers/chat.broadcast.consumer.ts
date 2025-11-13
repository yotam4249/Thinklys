import mongoose from "mongoose";
import { Server } from "socket.io";
import { ChatModel } from "../models/chat.model";
import { MessageModel } from "../models/message.model";
import { UserModel } from "../models/user.model";
import { createConsumer, Topics } from "../services/kafka.service";
import redis from "../services/redis.service";

type MsgRequestedEvent = {
    requestId: string;
    chatId: string;
    senderId: string;
    type: "text" | "image";
    text?: string;
    imageUrls?: string[];
    clientTs?: number; 
  };

function roomId(chatId: string) { return `chat:${chatId}`; }

export async function registerChatBroadcastConsumer(io: Server){
    const groupId = process.env.KAFKA_GROUP_BROADCAST || "adwise-broadcast"
    const consumer =  await createConsumer(groupId);
    if (!consumer) {
        console.warn("[KAFKA] Broadcast consumer disabled (no kafka).");
        return;
    }

    await consumer.subscribe({ topic: Topics.ChatMessageRequested, fromBeginning: false})
    console.log("[KAFKA] Broadcast consumer subscribed:", Topics.ChatMessageRequested);

    await consumer.run({
        eachMessage: async({ message, partition, topic}) =>{
            try{
                const raw = message.value?.toString("utf-8") || "{}" ;
                const evt: MsgRequestedEvent = JSON.parse(raw);
                console.log("[KAFKA] consume", { topic, partition, offset: message.offset, key: message.key?.toString(), requestId: evt.requestId, chatId: evt.chatId });
                if(evt.requestId){
                    const key = `dedup:chat.req:${evt.requestId}`;
                    const exists = await redis.get(key);
                    if (exists) return;
                    await redis.set(key, "1", "EX", 60);
                }

                if (!evt.chatId || !evt.senderId) return;

                const chat = await ChatModel.findById(evt.chatId).select("_id members");
                if (!chat) return;
                if (!chat.members.some((m) => String(m) === evt.senderId)) return;

                const msg = await MessageModel.create({
                    chatId: new mongoose.Types.ObjectId(evt.chatId),
                    senderId: new mongoose.Types.ObjectId(evt.senderId),
                    type: evt.type,
                    text: evt.text || undefined,
                    imageUrls: Array.isArray(evt.imageUrls) && evt.imageUrls.length ? evt.imageUrls : undefined,
                })

                const lastMessageText =
                evt.text && evt.text.trim()
                  ? evt.text.trim()
                  : (Array.isArray(evt.imageUrls) && evt.imageUrls.length
                      ? `${evt.imageUrls.length} image${evt.imageUrls.length > 1 ? "s" : ""}`
                      : "");
      
                await ChatModel.updateOne(
                    { _id: evt.chatId },
                    { $set: { lastMessageText, lastMessageAt: msg.createdAt }, $inc: { messageCount: 1 } }
                );
      
                const sender = await UserModel.findById(evt.senderId).select("profileImage gender").lean();

                io.to(roomId(evt.chatId)).emit("message:new", {
                    _id: String(msg._id),
                    chatId: evt.chatId,
                    senderId: evt.senderId,
                    type: evt.type,
                    text: evt.text || undefined,
                    imageUrls: Array.isArray(evt.imageUrls) && evt.imageUrls.length ? evt.imageUrls : undefined,
                    createdAt: msg.createdAt,
                    senderProfileImage: sender?.profileImage ?? null,
                    senderGender: sender?.gender ?? null,
                  });

                  for (const m of chat.members) {
                    await redis.del(`u:${String(m)}:recent_chats`);
                  }
                  console.log("[KAFKA] stored+broadcast", { msgId: String(msg._id), chatId: evt.chatId });
            } catch (e) {
                console.error("[KAFKA] Broadcast consumer error:", e);
            }
        }
    })
}