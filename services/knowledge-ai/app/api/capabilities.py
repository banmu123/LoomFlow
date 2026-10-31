"""能力查询：供 Node.js 侧在启用 fastapi provider 前做能力探测。

M1 阶段不含检索实现，因此所有检索能力位均为 false。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app import __version__
from app.core.security import require_service_token
from app.schemas.common import ErrorResponse
from app.schemas.health import CapabilitiesResponse, CapabilityFlags

router = APIRouter(
    prefix="/knowledge",
    tags=["knowledge"],
    dependencies=[Depends(require_service_token)],
    responses={
        401: {"model": ErrorResponse, "description": "内部服务密钥缺失或错误"},
        503: {"model": ErrorResponse, "description": "服务端未配置内部服务密钥"},
    },
)


@router.get(
    "/capabilities",
    response_model=CapabilitiesResponse,
    summary="查询知识库服务能力",
    description="服务间调用（需 X-Loomflow-Service-Token）。返回当前阶段真实支持的能力集合。",
)
async def capabilities(request: Request) -> CapabilitiesResponse:
    settings = request.app.state.settings
    return CapabilitiesResponse(
        service=settings.app_name,
        version=__version__,
        features=CapabilityFlags(),
    )
