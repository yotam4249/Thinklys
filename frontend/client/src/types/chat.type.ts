export type ChatMessage = {
    _id: string;
    chatId: string;
    senderId: string;
    type?: "text" | "image" | "ai";
    text?: string;
    imageUrls?: string[]; // S3 keys for images
    createdAt?: string;
  
    // sender info
    senderProfileImage?: string | null; // S3 key for profile image
    senderGender?: "male" | "female" | "other" | "prefer_not_to_say" | null;
  
    // client-side helpers
    pending?: boolean;
    clientId?: string;   // used to match optimistic -> server echo
  };
  