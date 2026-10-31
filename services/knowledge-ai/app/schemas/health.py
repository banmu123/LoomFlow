"""请求/响应模型（Pydantic 2）。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = Field(default="ok", description="固定为 ok，异常时不返回 200")
    service: str = Field(description="服务名")
    version: str = Field(description="服务版本")
    environment: str = Field(description="运行环境：development / test / production")
    timestamp: datetime = Field(description="UTC 时间戳")


class CapabilityFlags(BaseModel):
    """当前阶段真实具备的能力；M1 全部为 false，避免上层误判。"""

    document_parsing: bool = False
    chunking: bool = False
    embedding: bool = False
    vector_search: bool = False
    hybrid_search: bool = False
    rerank: bool = False


class CapabilitiesResponse(BaseModel):
    provider: Literal["fastapi"] = "fastapi"
    service: str
    version: str
    stage: str = Field(default="skeleton", description="实现阶段：skeleton / chunking / retrieval")
    features: CapabilityFlags
