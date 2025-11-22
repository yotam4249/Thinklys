

from datetime import date
from typing import List, Optional
from app.models.RefreshToken import RefreshToken
from app.models.base import Base
from app.models.enums.gender import GenderDBType, GenderEnum
from app.models.quiz_result import QuizResult
from sqlalchemy import Date, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

class User(Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        unique=True,
        index=True
    )

    password: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    dateOfBirth: Mapped[Optional[date]] = mapped_column(
        Date,
        nullable=True
    )

    gender: Mapped[Optional[GenderEnum]] = mapped_column(
        GenderDBType,
        nullable=True
    )

    profileImage: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
    )


    

    refresh_token: Mapped[Optional["RefreshToken"]] = relationship(
        back_populates="user",
        uselist=False, 
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    quiz_results: Mapped[List["QuizResult"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    chats: Mapped[List["Chat"]] = relationship(
        "Chat",
        secondary="chat_members",
        back_populates="members",
        lazy="selectin",
    )


Index("ix_users_username_unique", User.username, unique=True)