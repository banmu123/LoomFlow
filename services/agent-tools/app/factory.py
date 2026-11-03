"""应用工厂。"""

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
from app.core.telemetry import instrument_fastapi

REQUEST_ID_HEADER = "X-Request-Id"
logger = logging.getLogger("loomflow.agent_tools")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "LoomFlow 内部工具服务：表格处理、文档解析、结构化提取。"
            "不提供任意代码执行能力，仅接受带内部服务密钥的服务间调用。"
        ),
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
    )
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

        log = logger.debug if request.url.path in ("/health", "/ready") else logger.info
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
    # 先注册异常处理，再挂 OTel 中间件（顺序影响 Span 是否能覆盖异常路径）
    instrument_fastapi(app, settings.app_name)
    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app
