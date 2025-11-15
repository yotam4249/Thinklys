import enum
from sqlalchemy import Enum as SAEnum

class GenderEnum(str, enum.Enum):
    male = "male"
    female = "female"
    other = "other"
    prefer_not_to_say = "prefer_not_to_say"


GenderDBType = SAEnum(GenderEnum, name="gender_enum", create_constraint=True)
