"""统一错误响应模型（仅用于 OpenAPI 文档描述）。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str = Field(description="稳定的机器可读错误码，如 unauthorized")
    message: str = Field(description="人类可读错误信息")
    details: Any | None = Field(default=None, description="可选的补充信息（如字段校验明细）")


class ErrorResponse(BaseModel):
    error: ErrorDetail
