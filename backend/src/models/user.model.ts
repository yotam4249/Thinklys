import mongoose, { Schema, Document, Model } from "mongoose";

export interface IQuizResult {
  topic: string;
  level: string;
  score: number;
  total: number;
  completedAt: Date;
}

export interface IUser extends Document {
  username: string;
  password: string;       
  dateOfBirth?: Date;
  gender?: "male" | "female" | "other" | "prefer_not_to_say";
  refreshTokens: string[]; 
  profileImage?: string | null;
  quizHistory: IQuizResult[];
}

const quizResultSchema = new Schema<IQuizResult>(
  {
    topic: { type: String, required: true },
    level: { type: String, required: true },
    score: { type: Number, required: true },
    total: { type: Number, required: true },
    completedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true, 
      minlength: 3,
      maxlength: 30,
      unique: true,   
      index: true,
    },
    password: { type: String, required: true },
    refreshTokens: { type: [String], default: [] },
    dateOfBirth: { type: Date },
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say"],
    },
    profileImage: { type: String ,default: null},
    quizHistory: { type: [quizResultSchema], default: [] },
  },
  { timestamps: true }
);

userSchema.index({ username: 1 }, { unique: true });

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", userSchema);
