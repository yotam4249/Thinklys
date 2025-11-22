# app/api/routes/chat_routes.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.db import get_db
from app.middleware.auth_middleware import get_current_user
from app.services.chat_service import ChatService
from app.api.dto.chat_dto import (
    CreateGroupChatDTO,
    CreateDmChatDTO,
    ChatResponseDTO,
    ChatListItemDTO,
    ChatListResponseDTO,
    ChatMemberDTO,
    MessageResponseDTO,
    MessagesResponseDTO,
)
from app.models.chat import Chat
from app.models.message import Message
from app.models.enums.chat_type import ChatTypeEnum

router = APIRouter(prefix="/chat", tags=["chat"])


def _chat_to_response(chat: Chat, user_id: uuid.UUID, include_members: bool = False) -> ChatResponseDTO:
    """Convert Chat model to ChatResponseDTO."""
    # Check if user is member
    is_member = False
    if chat.members:
        is_member = any(str(m.id) == str(user_id) for m in chat.members)

    # For DMs, compute title from other person's username
    title = chat.title or "(untitled)"
    if chat.type == ChatTypeEnum.dm and chat.members:
        # Find the other person (not the current user)
        # Convert user_id to UUID if it's a string for proper comparison
        user_id_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        # Filter out the current user to get the other member
        other_members = [m for m in chat.members if m.id != user_id_uuid]
        if other_members:
            other_member = other_members[0]
            title = other_member.username or title
            print(f"[DEBUG] DM title computed: chat_id={chat.id}, user_id={user_id_uuid}, title={title}, other_member_id={other_member.id}, other_member_username={other_member.username}, all_members={[str(m.id) + ':' + m.username for m in chat.members]}")
        else:
            # Debug: log if we couldn't find the other member
            print(f"[DEBUG] DM title: chat_id={chat.id}, user_id={user_id_uuid}, members={[str(m.id) + ':' + m.username for m in chat.members]}")

    members = None
    if include_members and chat.members:
        # For DMs, only return the other member (not the current user)
        if chat.type == ChatTypeEnum.dm:
            user_id_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
            other_members = [m for m in chat.members if m.id != user_id_uuid]
            members = [
                ChatMemberDTO(
                    _id=str(m.id),
                    username=m.username,
                    fullName=None,  # Not in our User model
                    name=None,  # Not in our User model
                    email=None,  # Not in our User model
                    profileImage=m.profileImage,
                    gender=m.gender.value if m.gender else None,
                )
                for m in other_members
            ]
        else:
            # For groups, return all members
            members = [
                ChatMemberDTO(
                    _id=str(m.id),
                    username=m.username,
                    fullName=None,  # Not in our User model
                    name=None,  # Not in our User model
                    email=None,  # Not in our User model
                    profileImage=m.profileImage,
                    gender=m.gender.value if m.gender else None,
                )
                for m in chat.members
            ]

    return ChatResponseDTO(
        id=str(chat.id),
        type=chat.type,
        title=title,
        lastMessageText=chat.last_message_text,
        lastMessageAt=chat.last_message_at,
        isMember=is_member if not include_members else None,
        members=members,
    )


def _chat_to_list_item(chat: Chat, user_id: uuid.UUID) -> ChatListItemDTO:
    """Convert Chat model to ChatListItemDTO."""
    # Check if user is member
    # For DMs, user is always a member
    is_member = False
    if chat.type == ChatTypeEnum.dm:
        is_member = True
    elif chat.members:
        is_member = any(str(m.id) == str(user_id) for m in chat.members)

    # For DMs, compute title from other person's username
    title = chat.title or "(untitled)"
    if chat.type == ChatTypeEnum.dm and chat.members:
        # Find the other person (not the current user)
        # Convert user_id to UUID if it's a string for proper comparison
        user_id_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        # Filter out the current user to get the other member
        other_members = [m for m in chat.members if m.id != user_id_uuid]
        if other_members:
            other_member = other_members[0]
            title = other_member.username or title
        else:
            # Debug: log if we couldn't find the other member
            print(f"[DEBUG] DM title (list): chat_id={chat.id}, user_id={user_id_uuid}, members={[str(m.id) + ':' + m.username for m in chat.members]}")

    return ChatListItemDTO(
        id=str(chat.id),
        type=chat.type,
        title=title,
        lastMessageText=chat.last_message_text or "",
        lastMessageAt=chat.last_message_at,
        isMember=is_member,
    )


@router.post("/dm", response_model=ChatResponseDTO)
async def create_dm_chat(
    dto: CreateDmChatDTO,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a DM chat by username."""
    try:
        creator_id = uuid.UUID(current_user["id"])

        chat, reused = await ChatService.create_dm_chat(
            db=db,
            creator_id=creator_id,
            other_username=dto.username,
        )

        # Reload chat with members to compute DM title
        from sqlalchemy.orm import selectinload
        from sqlalchemy import select
        chat_result = await db.execute(
            select(Chat).where(Chat.id == chat.id).options(selectinload(Chat.members))
        )
        chat = chat_result.scalar_one_or_none() or chat

        response = _chat_to_response(chat, creator_id, include_members=False)
        # Add reused flag to response
        response_dict = response.model_dump()
        response_dict["reused"] = reused
        return response_dict
    except ValueError as e:
        error_code = str(e)
        if error_code == "USER_NOT_FOUND":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail={"code": error_code}
            )
        elif error_code == "CANNOT_DM_SELF":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )


@router.post("/group", response_model=ChatResponseDTO, status_code=status.HTTP_201_CREATED)
async def create_group_chat(
    dto: CreateGroupChatDTO,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new group chat."""
    try:
        creator_id = uuid.UUID(current_user["id"])

        # Parse member IDs if provided
        member_ids = None
        if dto.members:
            try:
                member_ids = [uuid.UUID(mid) for mid in dto.members]
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "INVALID_MEMBER_ID"},
                )

        chat = await ChatService.create_group_chat(
            db=db,
            creator_id=creator_id,
            title=dto.title,
            member_ids=member_ids,
        )

        return _chat_to_response(chat, creator_id, include_members=False)
    except ValueError as e:
        error_code = str(e)
        if error_code == "INVALID_MEMBER_ID":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )


@router.post("/{chat_id}/join")
async def join_group_chat(
    chat_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Join a group chat."""
    try:
        user_id = uuid.UUID(current_user["id"])
        cid = uuid.UUID(chat_id)

        await ChatService.join_group_chat(db=db, chat_id=cid, user_id=user_id)

        return {"ok": True}
    except ValueError as e:
        error_code = str(e)
        if error_code == "CHAT_NOT_FOUND":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail={"code": error_code}
            )
        elif error_code == "NOT_A_GROUP":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail={"code": error_code}
            )
        elif error_code == "USER_NOT_FOUND":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )


@router.get("", response_model=ChatListResponseDTO)
async def list_chats(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(15, ge=1, le=100),
):
    """List chats for the current user."""
    try:
        user_id = uuid.UUID(current_user["id"])

        chats, has_more = await ChatService.list_chats(
            db=db, user_id=user_id, page=page, limit=limit
        )

        items = [_chat_to_list_item(chat, user_id) for chat in chats]

        return ChatListResponseDTO(
            items=items,
            page=page,
            pageSize=limit,
            hasMore=has_more,
        )
    except Exception as e:
        print(f"list_chats error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )


@router.get("/{chat_id}", response_model=ChatResponseDTO)
async def get_chat(
    chat_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get chat metadata by ID."""
    try:
        user_id = uuid.UUID(current_user["id"])
        cid = uuid.UUID(chat_id)

        chat = await ChatService.get_chat_by_id(db=db, chat_id=cid, include_members=True)

        if not chat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail={"code": "CHAT_NOT_FOUND"}
            )

        # Privacy: DM meta only for members; groups are public
        if chat.type == ChatTypeEnum.dm:
            is_member = await ChatService.is_user_member(db=db, chat_id=cid, user_id=user_id)
            if not is_member:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"}
                )

        return _chat_to_response(chat, user_id, include_members=True)
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Invalid chat ID"},
        )
    except Exception as e:
        print(f"get_chat error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )


@router.get("/{chat_id}/messages", response_model=MessagesResponseDTO)
async def get_messages(
    chat_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=100),
):
    """Get messages for a chat with cursor-based pagination."""
    try:
        user_id = uuid.UUID(current_user["id"])
        cid = uuid.UUID(chat_id)

        cursor_uuid = None
        if cursor:
            try:
                cursor_uuid = uuid.UUID(cursor)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "BAD_REQUEST", "message": "Invalid cursor"},
                )

        messages, next_cursor = await ChatService.get_messages(
            db=db,
            chat_id=cid,
            user_id=user_id,
            cursor=cursor_uuid,
            limit=limit,
        )

        # Convert messages to response format
        items = []
        for msg in messages:
            sender = msg.sender
            # Compute sender name: fullName -> username -> name -> email -> fallback
            sender_name = str(msg.sender_id)[:6]  # fallback
            if sender:
                sender_name = (
                    sender.username
                    or sender.email
                    or sender_name
                )

            items.append(
                MessageResponseDTO(
                    _id=str(msg.id),
                    chatId=str(msg.chat_id),
                    senderId=str(msg.sender_id),
                    type=msg.type,
                    text=msg.text,
                    imageUrls=msg.image_urls or [],
                    createdAt=msg.created_at,
                    senderName=sender_name,
                    senderProfileImage=sender.profileImage if sender else None,
                    senderGender=sender.gender.value if sender and sender.gender else None,
                )
            )

        return MessagesResponseDTO(
            items=items,
            nextCursor=str(next_cursor) if next_cursor else None,
        )
    except ValueError as e:
        error_code = str(e)
        if error_code == "CHAT_NOT_FOUND":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail={"code": error_code}
            )
        elif error_code == "FORBIDDEN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"get_messages error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )

