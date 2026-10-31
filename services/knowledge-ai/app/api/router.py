"""业务路由汇总：统一挂载在 settings.api_prefix 之下。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import capabilities

api_router = APIRouter()
api_router.include_router(capabilities.router)
