"""业务路由汇总。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import tools

api_router = APIRouter()
api_router.include_router(tools.router)
