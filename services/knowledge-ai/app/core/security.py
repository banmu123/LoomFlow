"""内部服务认证。

Node.js 侧在服务端调用时附带 X-Loomflow-Service-Token；浏览器永远拿不到该密钥。
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Annotated

from fastapi import Header, HTTPException, Request, status

logger = logging.getLogger(__name__)

SERVICE_TOKEN_HEADER = "X-Loomflow-Service-Token"


def _digest(value: str) -> bytes:
    """定长摘要：把比较对象统一成 32 字节，避免长度差异造成的提前返回。"""
    return hashlib.sha256(value.encode("utf-8")).digest()


def tokens_match(provided: str | None, expected: str | None) -> bool:
    """常量时间比较，任一侧为空一律不通过（失败关闭）。"""
    if not provided or not expected:
        return False
    return hmac.compare_digest(_digest(provided), _digest(expected))


async def require_service_token(
    request: Request,
    x_loomflow_service_token: Annotated[
        str | None,
        Header(alias=SERVICE_TOKEN_HEADER, description="LoomFlow 内部服务密钥"),
    ] = None,
) -> None:
    """FastAPI 依赖：校验内部服务密钥。

    - 服务端未配置密钥：503（拒绝服务，而不是放行）
    - 缺失或错误：401
    """
    expected = request.app.state.settings.service_token

    if not expected:
        logger.error(
            "service token is not configured; rejecting %s %s",
            request.method,
            request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal service token is not configured",
        )

    if not tokens_match(x_loomflow_service_token, expected):
        logger.warning(
            "rejected request with invalid service token: %s %s",
            request.method,
            request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing service token",
        )
