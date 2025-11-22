# app/api/dto/chat_dto.py
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field
from app.models.enums.chat_type import ChatTypeEnum
from app.models.enums.message_type import MessageTypeEnum


class CreateGroupChatDTO(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    members: Optional[List[str]] = None  # List of user IDs (UUIDs as strings)


class ChatMemberDTO(BaseModel):
    _id: str  # Frontend expects _id
    username: Optional[str] = None
    fullName: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    profileImage: Optional[str] = None
    gender: Optional[str] = None

    class Config:
        from_attributes = True


class ChatResponseDTO(BaseModel):
    id: str
    type: ChatTypeEnum
    title: str
    lastMessageText: Optional[str] = None
    lastMessageAt: Optional[datetime] = None
    isMember: Optional[bool] = None  # For list endpoint
    members: Optional[List[ChatMemberDTO]] = None  # For detail endpoint

    class Config:
        from_attributes = True


class ChatListItemDTO(BaseModel):
    id: str
    type: ChatTypeEnum
    title: str
    lastMessageText: str
    lastMessageAt: Optional[datetime] = None
    isMember: bool

    class Config:
        from_attributes = True


class ChatListResponseDTO(BaseModel):
    items: List[ChatListItemDTO]
    page: int
    pageSize: int
    hasMore: bool


class CreateDmChatDTO(BaseModel):
    username: str = Field(..., min_length=1)


class MessageResponseDTO(BaseModel):
    _id: str
    chatId: str
    senderId: str
    type: MessageTypeEnum
    text: Optional[str] = None
    imageUrls: Optional[List[str]] = None
    createdAt: datetime
    senderName: str
    senderProfileImage: Optional[str] = None
    senderGender: Optional[str] = None


class MessagesResponseDTO(BaseModel):
    items: List[MessageResponseDTO]
    nextCursor: Optional[str] = None

