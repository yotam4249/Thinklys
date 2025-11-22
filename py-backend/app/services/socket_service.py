# app/services/socket_service.py
import socketio
from typing import Dict, Any, List, Union
import uuid
import re
from datetime import datetime, timezone

from app.core.security import verify_access_token
from app.core.config import settings
from app.models.chat import Chat, chat_members
from app.models.message import Message
from app.models.user import User
from app.models.enums.message_type import MessageTypeEnum
from app.core.redis import get_redis

# Get CORS origins from settings
cors_origins: List[Union[str, re.Pattern]] = []
if isinstance(settings.CORS_ALLOWED_ORIGINS, list):
    cors_origins = settings.CORS_ALLOWED_ORIGINS
elif isinstance(settings.CORS_ALLOWED_ORIGINS, str):
    import json
    try:
        cors_origins = json.loads(settings.CORS_ALLOWED_ORIGINS)
    except json.JSONDecodeError:
        cors_origins = [origin.strip() for origin in settings.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]

# Add regex pattern if configured
if settings.CORS_ALLOWED_REGEX:
    cors_origins.append(re.compile(settings.CORS_ALLOWED_REGEX))

# Create Socket.IO server with CORS
sio = socketio.AsyncServer(
    cors_allowed_origins=cors_origins if cors_origins else "*",
    async_mode="asgi",
    logger=True,
    engineio_logger=True,
)


@sio.event
async def connect(sid: str, environ: Dict[str, Any], auth: Dict[str, Any]):
    """Handle Socket.IO connection with authentication."""
    token = auth.get("token") if auth else None
    if not token:
        print(f"[SOCKET] Connection rejected: No token provided for {sid}")
        return False
    
    try:
        # Verify access token
        payload = verify_access_token(token)
        user_id = payload.get("id") or payload.get("sub") or payload.get("_id")
        username = payload.get("username")
        
        if not user_id:
            print(f"[SOCKET] Connection rejected: Invalid token payload for {sid}")
            return False
        
        # Store user info in session
        await sio.save_session(sid, {"user_id": str(user_id), "username": username or ""})
        print(f"[SOCKET] Connected: {sid} (user: {user_id})")
        return True
    except Exception as e:
        print(f"[SOCKET] Connection rejected: Invalid token for {sid}: {e}")
        return False


@sio.event
async def disconnect(sid: str):
    """Handle Socket.IO disconnection."""
    try:
        session = await sio.get_session(sid)
        user_id = session.get("user_id", "unknown")
        print(f"[SOCKET] Disconnected: {sid} (user: {user_id})")
    except:
        print(f"[SOCKET] Disconnected: {sid}")


@sio.on("chat:join")
async def chat_join(sid: str, data: Dict[str, Any]):
    """Handle chat:join event - join a chat room."""
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        return
    
    chat_id = data.get("chatId")
    if not chat_id:
        return
    
    # Verify user is a member of the chat
    from app.core.db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            from sqlalchemy import select, and_
            result = await db.execute(
                select(chat_members).where(
                    and_(
                        chat_members.c.chat_id == uuid.UUID(chat_id),
                        chat_members.c.user_id == uuid.UUID(user_id),
                    )
                )
            )
            is_member = result.scalar_one_or_none() is not None
            if not is_member:
                print(f"[SOCKET] User {user_id} tried to join chat {chat_id} but is not a member")
                return
            
            room = f"chat:{chat_id}"
            await sio.enter_room(sid, room)
            print(f"[SOCKET] User {user_id} joined chat {chat_id}")
        except Exception as e:
            print(f"[SOCKET] Error joining chat: {e}")


@sio.on("chat:leave")
async def chat_leave(sid: str, data: Dict[str, Any]):
    """Handle chat:leave event - leave a chat room."""
    chat_id = data.get("chatId")
    if not chat_id:
        return
    
    room = f"chat:{chat_id}"
    await sio.leave_room(sid, room)
    session = await sio.get_session(sid)
    user_id = session.get("user_id", "unknown")
    print(f"[SOCKET] User {user_id} left chat {chat_id}")


@sio.on("message:send")
async def message_send(sid: str, data: Dict[str, Any]):
    """Handle message:send event - send a message."""
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        return
    
    chat_id = data.get("chatId")
    text = data.get("text", "").strip() if data.get("text") else ""
    image_urls = data.get("imageUrls", []) or []
    msg_type_str = data.get("type", "text")
    
    # Validate: must have either text or images
    if not text and not image_urls:
        return
    
    # Determine message type
    if image_urls:
        msg_type = MessageTypeEnum.image if not text else MessageTypeEnum.text
    else:
        msg_type = MessageTypeEnum.text
    
    try:
        user_uuid = uuid.UUID(user_id)
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        print(f"[SOCKET] Invalid UUID: user_id={user_id}, chat_id={chat_id}")
        return
    
    # Create message in database and broadcast
    from app.core.db import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            from sqlalchemy import select, and_, func
            from sqlalchemy.orm import selectinload
            
            # Verify user is a member of the chat
            result = await db.execute(
                select(chat_members).where(
                    and_(
                        chat_members.c.chat_id == chat_uuid,
                        chat_members.c.user_id == user_uuid,
                    )
                )
            )
            is_member = result.scalar_one_or_none() is not None
            if not is_member:
                print(f"[SOCKET] User {user_id} tried to send message to chat {chat_id} but is not a member")
                return
            
            # Get chat to update
            chat_result = await db.execute(
                select(Chat).where(Chat.id == chat_uuid).options(selectinload(Chat.members))
            )
            chat = chat_result.scalar_one_or_none()
            if not chat:
                print(f"[SOCKET] Chat {chat_id} not found")
                return
            
            # Create message
            message = Message(
                chat_id=chat_uuid,
                sender_id=user_uuid,
                type=msg_type,
                text=text if text else None,
                image_urls=image_urls if image_urls else None,
            )
            db.add(message)
            await db.flush()  # Flush to get the message ID
            
            # Update chat metadata
            last_message_text = text if text else f"{len(image_urls)} image{'s' if len(image_urls) > 1 else ''}"
            chat.last_message_text = last_message_text
            chat.last_message_at = datetime.now(timezone.utc)
            chat.message_count = (chat.message_count or 0) + 1
            
            await db.commit()
            await db.refresh(message)
            
            # Get sender info for broadcast
            sender_result = await db.execute(
                select(User).where(User.id == user_uuid)
            )
            sender = sender_result.scalar_one_or_none()
            
            # Prepare message data for broadcast
            sender_name = sender.username if sender else user_id[:6]
            message_data = {
                "_id": str(message.id),
                "chatId": chat_id,
                "senderId": user_id,
                "type": msg_type.value,
                "text": text if text else None,
                "imageUrls": image_urls if image_urls else None,
                "createdAt": message.created_at.isoformat(),
                "senderName": sender_name,
                "senderProfileImage": sender.profileImage if sender else None,
                "senderGender": sender.gender.value if sender and sender.gender else None,
            }
            
            # Broadcast to all users in the chat room
            room = f"chat:{chat_id}"
            await sio.emit("message:new", message_data, room=room)
            
            # Emit queued event to sender
            request_id = str(uuid.uuid4())
            await sio.emit("message:queued", {"requestId": request_id, "chatId": chat_id}, room=sid)
            
            # Invalidate cache for all chat members
            redis_client = await get_redis()
            for member in chat.members:
                await redis_client.delete(f"u:{member.id}:recent_chats")
            
            print(f"[SOCKET] Message created and broadcast: {message.id} in chat {chat_id} by user {user_id}")
        except Exception as e:
            print(f"[SOCKET] Error sending message: {e}")
            import traceback
            traceback.print_exc()
            await db.rollback()

