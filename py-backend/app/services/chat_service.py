# app/services/chat_service.py
from datetime import datetime
from typing import List, Optional
import uuid
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload

from app.core.redis import get_redis
from app.models.chat import Chat, chat_members
from app.models.message import Message
from app.models.user import User
from app.models.enums.chat_type import ChatTypeEnum

CACHE_TTL_SECONDS = 120


class ChatService:
    """Chat service with Redis caching."""

    @staticmethod
    def _get_cache_key(user_id: str) -> str:
        """Get Redis cache key for user's recent chats."""
        return f"u:{user_id}:recent_chats"

    @staticmethod
    async def invalidate_user_cache(user_id: str) -> None:
        """Invalidate cache for a user."""
        redis_client = await get_redis()
        key = ChatService._get_cache_key(user_id)
        await redis_client.delete(key)

    @staticmethod
    async def get_cached_chats(user_id: str) -> Optional[List[dict]]:
        """Get cached recent chats for a user."""
        redis_client = await get_redis()
        key = ChatService._get_cache_key(user_id)
        cached = await redis_client.get(key)
        if cached:
            try:
                return json.loads(cached)
            except json.JSONDecodeError:
                pass
        return None

    @staticmethod
    async def set_cached_chats(user_id: str, chats: List[dict]) -> None:
        """Cache recent chats for a user."""
        redis_client = await get_redis()
        key = ChatService._get_cache_key(user_id)
        await redis_client.setex(key, CACHE_TTL_SECONDS, json.dumps(chats))

    @staticmethod
    async def create_group_chat(
        db: AsyncSession,
        creator_id: uuid.UUID,
        title: str,
        member_ids: Optional[List[uuid.UUID]] = None,
    ) -> Chat:
        """Create a new group chat."""
        # Ensure creator is included in members
        all_member_ids = set([creator_id])
        if member_ids:
            all_member_ids.update(member_ids)

        # Get user objects for members
        result = await db.execute(
            select(User).where(User.id.in_(list(all_member_ids)))
        )
        members = result.scalars().all()

        if len(members) != len(all_member_ids):
            raise ValueError("INVALID_MEMBER_ID")

        # Create chat
        chat = Chat(
            type=ChatTypeEnum.group,
            title=title.strip(),
            members=members,
        )
        db.add(chat)
        await db.commit()
        await db.refresh(chat)

        # Invalidate cache for all members
        for member_id in all_member_ids:
            await ChatService.invalidate_user_cache(str(member_id))

        return chat

    @staticmethod
    async def join_group_chat(
        db: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Chat:
        """Join a user to a group chat."""
        # Get chat
        result = await db.execute(
            select(Chat)
            .where(Chat.id == chat_id)
            .options(selectinload(Chat.members))
        )
        chat = result.scalar_one_or_none()

        if not chat:
            raise ValueError("CHAT_NOT_FOUND")

        if chat.type != ChatTypeEnum.group:
            raise ValueError("NOT_A_GROUP")

        # Check if already a member
        member_ids = [m.id for m in chat.members]
        if user_id in member_ids:
            return chat  # Already a member

        # Get user and add to members
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise ValueError("USER_NOT_FOUND")

        chat.members.append(user)
        await db.commit()
        await db.refresh(chat)

        # Invalidate cache
        await ChatService.invalidate_user_cache(str(user_id))

        return chat

    @staticmethod
    async def get_chat_by_id(
        db: AsyncSession,
        chat_id: uuid.UUID,
        include_members: bool = True,
    ) -> Optional[Chat]:
        """Get chat by ID."""
        query = select(Chat).where(Chat.id == chat_id)
        if include_members:
            query = query.options(selectinload(Chat.members))
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_chats(
        db: AsyncSession,
        user_id: uuid.UUID,
        page: int = 1,
        limit: int = 15,
    ) -> tuple[List[Chat], bool]:
        """List chats for a user with pagination."""
        # Try cache first (only for first page)
        if page == 1:
            cached = await ChatService.get_cached_chats(str(user_id))
            if cached:
                # Convert cached data back to Chat-like objects
                # For now, we'll still query DB but use cache for optimization
                pass

        # Calculate offset
        offset = (page - 1) * limit

        # Get user's chats (chats where user is a member)
        user_chats_query = (
            select(Chat)
            .join(chat_members, Chat.id == chat_members.c.chat_id)
            .where(chat_members.c.user_id == user_id)
            .options(selectinload(Chat.members))
            .order_by(Chat.updated_at.desc())
        )

        # Get all public groups
        public_groups_query = (
            select(Chat)
            .where(Chat.type == ChatTypeEnum.group)
            .options(selectinload(Chat.members))
            .order_by(Chat.updated_at.desc())
        )

        # Execute queries
        user_chats_result = await db.execute(user_chats_query)
        user_chats = user_chats_result.scalars().all()

        public_groups_result = await db.execute(public_groups_query)
        public_groups = public_groups_result.scalars().all()

        # Combine and deduplicate
        chat_map = {chat.id: chat for chat in user_chats}
        for group in public_groups:
            if group.id not in chat_map:
                chat_map[group.id] = group

        # Sort by updated_at
        all_chats = sorted(
            list(chat_map.values()),
            key=lambda c: c.updated_at or c.created_at,
            reverse=True,
        )

        # Cache first 30 for page 1
        if page == 1:
            cache_data = [
                {
                    "id": str(c.id),
                    "type": c.type.value,
                    "title": c.title or "(untitled)",
                    "lastMessageText": c.last_message_text or "",
                    "lastMessageAt": (
                        c.last_message_at.isoformat()
                        if c.last_message_at
                        else None
                    ),
                    "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
                    "members": [str(m.id) for m in c.members] if hasattr(c, "members") else [],
                }
                for c in all_chats[:30]
            ]
            await ChatService.set_cached_chats(str(user_id), cache_data)

        # Paginate
        total = len(all_chats)
        paginated_chats = all_chats[offset : offset + limit]
        has_more = offset + limit < total

        return paginated_chats, has_more

    @staticmethod
    async def is_user_member(
        db: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        """Check if user is a member of the chat."""
        result = await db.execute(
            select(chat_members).where(
                and_(
                    chat_members.c.chat_id == chat_id,
                    chat_members.c.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none() is not None

    @staticmethod
    async def create_dm_chat(
        db: AsyncSession,
        creator_id: uuid.UUID,
        other_username: str,
    ) -> tuple[Chat, bool]:
        """Create or get existing DM chat by username.
        Returns (chat, reused) where reused=True if DM already existed.
        """
        # Find other user by username (case-insensitive)
        result = await db.execute(
            select(User).where(func.lower(User.username) == func.lower(other_username))
        )
        other_user = result.scalar_one_or_none()

        if not other_user:
            raise ValueError("USER_NOT_FOUND")

        other_id = other_user.id

        if other_id == creator_id:
            raise ValueError("CANNOT_DM_SELF")

        # Check if DM already exists between these two users
        # Get all DMs where creator is a member
        creator_chats_result = await db.execute(
            select(Chat)
            .join(chat_members, Chat.id == chat_members.c.chat_id)
            .where(
                and_(
                    chat_members.c.user_id == creator_id,
                    Chat.type == ChatTypeEnum.dm,
                )
            )
            .options(selectinload(Chat.members))
        )
        creator_chats = creator_chats_result.scalars().all()

        # Check if any of these DMs has exactly 2 members: creator and other
        for chat in creator_chats:
            if len(chat.members) == 2:
                member_ids = {m.id for m in chat.members}
                if creator_id in member_ids and other_id in member_ids:
                    # Found existing DM
                    await ChatService.invalidate_user_cache(str(creator_id))
                    await ChatService.invalidate_user_cache(str(other_id))
                    return chat, True

        # Create new DM
        creator_result = await db.execute(select(User).where(User.id == creator_id))
        creator = creator_result.scalar_one_or_none()
        if not creator:
            raise ValueError("USER_NOT_FOUND")

        chat = Chat(
            type=ChatTypeEnum.dm,
            title="(DM)",
            members=[creator, other_user],
        )
        db.add(chat)
        await db.commit()
        await db.refresh(chat)
        
        # Reload with members to ensure they're available
        chat_result = await db.execute(
            select(Chat)
            .where(Chat.id == chat.id)
            .options(selectinload(Chat.members))
        )
        chat = chat_result.scalar_one_or_none() or chat

        # Invalidate cache for both users
        await ChatService.invalidate_user_cache(str(creator_id))
        await ChatService.invalidate_user_cache(str(other_id))

        return chat, False

    @staticmethod
    async def get_messages(
        db: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        cursor: Optional[uuid.UUID] = None,
        limit: int = 30,
    ) -> tuple[List[Message], Optional[uuid.UUID]]:
        """Get messages for a chat with cursor-based pagination.
        Returns (messages, next_cursor).
        """
        # Verify chat exists and user has access
        chat = await ChatService.get_chat_by_id(db=db, chat_id=chat_id, include_members=False)
        if not chat:
            raise ValueError("CHAT_NOT_FOUND")

        # Privacy check: DMs require membership
        if chat.type == ChatTypeEnum.dm:
            is_member = await ChatService.is_user_member(db=db, chat_id=chat_id, user_id=user_id)
            if not is_member:
                raise ValueError("FORBIDDEN")

        # Build query
        query = select(Message).where(Message.chat_id == chat_id)

        if cursor:
            query = query.where(Message.id < cursor)

        query = (
            query.options(selectinload(Message.sender))
            .order_by(Message.created_at.desc())
            .limit(min(limit, 100))
        )

        result = await db.execute(query)
        messages = result.scalars().all()

        # Reverse to get chronological order (oldest first)
        messages = list(reversed(messages))

        # Get next cursor (ID of the oldest message we fetched)
        next_cursor = messages[0].id if messages else None

        return messages, next_cursor

