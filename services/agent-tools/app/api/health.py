"""健康检查与就绪检查。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app import __version__
from app.schemas.health import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="存活探针")
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        service=settings.app_name,
        version=__version__,
        environment=settings.app_env.value,
        timestamp=datetime.now(timezone.utc),
    )


@router.get("/ready", response_model=ReadinessResponse, summary="就绪检查")
async def ready(request: Request) -> ReadinessResponse:
    """检查可选解析依赖是否可用；缺依赖时 ready=false（进程仍存活）。"""
    checks: dict[str, bool] = {}

    try:
        import pandas  # noqa: F401

        checks["pandas"] = True
    except ImportError:
        checks["pandas"] = False

    try:
        import pypdf  # noqa: F401

        checks["pdf"] = True
    except ImportError:
        checks["pdf"] = False

    try:
        import docx  # noqa: F401

        checks["docx"] = True
    except ImportError:
        checks["docx"] = False

    return ReadinessResponse(
        ready=all(checks.values()),
        checks=checks,
        timestamp=datetime.now(timezone.utc),
    )
