"""响应模型：健康检查与就绪检查。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    environment: str
    timestamp: datetime


class ReadinessResponse(BaseModel):
    ready: bool
    checks: dict[str, bool] = Field(default_factory=dict)
    timestamp: datetime
