# app/models/chat.py
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
import uuid

from app.models.base import Base
from app.models.enums.chat_type import ChatTypeEnum, ChatTypeDBType
from sqlalchemy import String, DateTime, Integer, Index, Table, Column, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

# Many-to-many relationship table for chat members
chat_members = Table(
    "chat_members",
    Base.metadata,
    Column("chat_id", UUID(as_uuid=True), ForeignKey("chat.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_chat_members_chat_id", "chat_id"),
    Index("ix_chat_members_user_id", "user_id"),
)


class Chat(Base):
    __tablename__ = "chat"

    type: Mapped[ChatTypeEnum] = mapped_column(
        ChatTypeDBType,
        nullable=False,
    )

    title: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )

    last_message_text: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )

    last_message_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    message_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    # Many-to-many relationship with users
    members: Mapped[List["User"]] = relationship(
        "User",
        secondary=chat_members,
        back_populates="chats",
        lazy="selectin",
    )

    # One-to-many relationship with messages
    messages: Mapped[List["Message"]] = relationship(
        "Message",
        back_populates="chat",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


# Index on chat for members and updated_at will be created separately if needed

