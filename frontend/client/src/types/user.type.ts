
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";

export type QuizResult = {
  topic: string;
  level: string;
  score: number;
  total: number;
  completedAt: string; // ISO date string
};

export type User = {
  id: string;
  username: string;
  dateOfBirth?: string; 
  gender?: Gender;
  profileImage?: string | null;
  /** Ephemeral presigned GET url for immediate display */
  profileImageUrl?: string | null;
  quizHistory?: QuizResult[];
};
