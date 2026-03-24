from enum import Enum
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
import uuid


def _uuid() -> str:
    return str(uuid.uuid4())


class TableType(str, Enum):
    singles = "singles"
    doubles = "doubles"


class TableStatus(str, Enum):
    open = "open"
    playing = "playing"
    closed = "closed"


class PlayMode(str, Enum):
    rotation = "rotation"
    winner_stays = "winner_stays"


class SkillLevel(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class RegisteredPlayer(BaseModel):
    id: str = Field(default_factory=_uuid)
    name: str = Field(..., min_length=1, max_length=20)
    registered_at: datetime = Field(default_factory=datetime.utcnow)


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=20)


class Player(BaseModel):
    id: str = Field(default_factory=_uuid)
    nickname: str
    skill: SkillLevel
    registered_id: Optional[str] = None
    joined_at: datetime = Field(default_factory=datetime.utcnow)


class Game(BaseModel):
    id: str = Field(default_factory=_uuid)
    players: list[Player]
    queued_at: datetime = Field(default_factory=datetime.utcnow)


class Table(BaseModel):
    id: str
    name: str
    type: TableType
    status: TableStatus = TableStatus.open
    play_mode: PlayMode = PlayMode.rotation
    max_wins: int = Field(default=3, ge=1, le=10)
    current_wins: int = 0
    current_game: Optional[Game] = None
    opponent: Optional[Game] = None
    queue: list[Game] = Field(default_factory=list)
    solo_pool: list[Player] = Field(default_factory=list)


# ── Request bodies ────────────────────────────────────────────────────────────

class JoinRequest(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=20)
    skill: SkillLevel
    player_id: Optional[str] = None
    partner_nickname: Optional[str] = Field(None, min_length=1, max_length=20)
    partner_skill: Optional[SkillLevel] = None
    partner_player_id: Optional[str] = None


class JoinSoloRequest(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=20)
    skill: SkillLevel
    player_id: Optional[str] = None


class CreateTableRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=50, pattern=r'^[a-z0-9-]+$')
    name: str = Field(..., min_length=1, max_length=50)
    type: TableType
    play_mode: PlayMode = PlayMode.rotation
    max_wins: int = Field(default=3, ge=1, le=10)


class PatchTableRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    status: Optional[TableStatus] = None
