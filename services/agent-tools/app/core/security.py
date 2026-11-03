"""内部服务认证：与 knowledge-ai 相同的常量时间比较策略。"""

from __future__ import annotations

import hashlib
import hmac
from typing import Annotated

from fastapi import Header, HTTPException, Request, status

SERVICE_TOKEN_HEADER = "X-Loomflow-Service-Token"


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


def tokens_match(provided: str | None, expected: str | None) -> bool:
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
    expected = request.app.state.settings.service_token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal service token is not configured",
        )
    if not tokens_match(x_loomflow_service_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing service token",
        )
