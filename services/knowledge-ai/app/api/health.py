"""健康检查：容器探针与运维自检使用，不走认证、不访问数据库。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app import __version__
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="存活探针",
    description="返回进程存活状态。刻意位于 API 前缀之外，避免探针依赖版本化路径。",
)
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        service=settings.app_name,
        version=__version__,
        environment=settings.app_env.value,
        timestamp=datetime.now(timezone.utc),
    )
