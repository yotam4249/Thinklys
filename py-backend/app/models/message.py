# app/models/message.py
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
import uuid

from app.models.base import Base
from app.models.enums.message_type import MessageTypeEnum, MessageTypeDBType
from sqlalchemy import String, DateTime, ForeignKey, Index, ARRAY
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class Message(Base):
    __tablename__ = "message"

    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    type: Mapped[MessageTypeEnum] = mapped_column(
        MessageTypeDBType,
        nullable=False,
    )

    text: Mapped[Optional[str]] = mapped_column(
        String(5000),
        nullable=True,
    )

    image_urls: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String),
        nullable=True,
        default=list,
    )

    # Relationships
    chat: Mapped["Chat"] = relationship(
        "Chat",
        back_populates="messages",
    )

    sender: Mapped["User"] = relationship(
        "User",
        lazy="selectin",
    )


Index("ix_message_chat_id_created_at", Message.chat_id, Message.created_at.desc())

