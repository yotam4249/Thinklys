import { Schema, model, Types, Model } from "mongoose";

export interface IChat {
  _id: Types.ObjectId;
  type: "dm" | "group";
  title?: string;
  members: Types.ObjectId[];     
  lastMessageText?: string;      
  lastMessageAt?: Date;           
  messageCount: number;            
  createdAt: Date;
  updatedAt: Date;
}

const ChatSchema = new Schema<IChat>(
  {
    type:    { type: String, enum: ["dm", "group"], required: true },
    title:   { type: String },
    members: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    lastMessageText: { type: String },
    lastMessageAt:   { type: Date },
    messageCount:    { type: Number, default: 0 },
  },
  { timestamps: true }
);

ChatSchema.index({ members: 1, updatedAt: -1 });

export const ChatModel: Model<IChat> =
  (model as any).Chat || model<IChat>("Chat", ChatSchema);
