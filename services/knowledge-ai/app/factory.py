"""应用工厂：便于测试注入独立配置，也避免 import 时就产生副作用。"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from app import __version__
from app.api.health import router as health_router
from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

REQUEST_ID_HEADER = "X-Request-Id"
logger = logging.getLogger("loomflow.knowledge_ai")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "LoomFlow 内部知识库/AI 服务。仅接受带内部服务密钥的服务间调用，"
            "不对外网暴露，也不执行用户提交的 Python 代码。"
        ),
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
    )
    # 依赖（security）通过 request.app.state 读取配置，无需全局单例
    app.state.settings = settings

    @app.middleware("http")
    async def request_context(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers[REQUEST_ID_HEADER] = request_id

        # 探针每 15s 一次，降到 DEBUG 避免刷日志
        log = logger.debug if request.url.path == "/health" else logger.info
        log(
            "%s %s -> %s (%.1f ms) request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response

    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app
