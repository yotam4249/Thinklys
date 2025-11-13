import { Schema, model, Types, Model } from "mongoose";

export type MessageType = "text" | "ai" | "image";

export interface IMessage {
  _id: Types.ObjectId;
  chatId: Types.ObjectId;
  senderId: Types.ObjectId;
  type: MessageType;
  text?: string;
  imageUrls?: string[]; // S3 keys for images
  createdAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    chatId:   { type: Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type:     { type: String, enum: ["text", "ai", "image"], required: true },
    text:     { type: String },
    imageUrls: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);


MessageSchema.index({ chatId: 1, _id: -1 });

export const MessageModel: Model<IMessage> =
  (model as any).Message || model<IMessage>("Message", MessageSchema);
