import enum
from sqlalchemy import Enum as SAEnum

class ChatTypeEnum(str, enum.Enum):
    dm = "dm"
    group = "group"


ChatTypeDBType = SAEnum(ChatTypeEnum, name="chat_type_enum", create_constraint=True)

