import enum
from sqlalchemy import Enum as SAEnum

class MessageTypeEnum(str, enum.Enum):
    text = "text"
    ai = "ai"
    image = "image"


MessageTypeDBType = SAEnum(MessageTypeEnum, name="message_type_enum", create_constraint=True)

