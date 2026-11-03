"""工具路由：统一鉴权、超时与响应包装。"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.core.errors import ToolError
from app.core.security import require_service_token
from app.schemas.tools import (
    AnalyzeRequest,
    DocumentParseRequest,
    ExtractRequest,
    TextCleanRequest,
    ToolErrorResponse,
    ToolMetadata,
    ToolResult,
    TransformRequest,
)
from app.services import data_tools, documents, extraction, text_tools

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tools",
    tags=["tools"],
    dependencies=[Depends(require_service_token)],
    responses={
        400: {"model": ToolErrorResponse},
        401: {"model": ToolErrorResponse},
        413: {"model": ToolErrorResponse},
        422: {"model": ToolErrorResponse},
        503: {"model": ToolErrorResponse},
        504: {"model": ToolErrorResponse},
    },
)


async def _run_tool(
    request: Request,
    tool: str,
    handler: Callable[[], tuple[dict[str, Any], dict[str, Any]]],
) -> ToolResult:
    """在独立线程执行 CPU 密集型工具，并施加服务端超时。

    说明：线程无法被强制杀死，超时只保证请求及时返回；
    输入体积与行数上限用于把单次耗时控制在可控范围。
    """
    settings = request.app.state.settings
    started = time.perf_counter()

    try:
        payload, meta = await asyncio.wait_for(
            run_in_threadpool(handler),
            timeout=settings.tool_timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise ToolError(
            "timeout",
            f"工具执行超时（{settings.tool_timeout_seconds:.0f}s 限制）",
            status_code=504,
        ) from exc

    duration_ms = int((time.perf_counter() - started) * 1000)
    logger.info("tool=%s duration_ms=%s", tool, duration_ms)

    return ToolResult(
        data=payload,
        metadata=ToolMetadata(
            tool=tool,
            duration_ms=duration_ms,
            truncated=bool(payload.get("truncated") or meta.get("truncated")),
            rows_scanned=meta.get("rows_scanned"),
        ),
    )


@router.post("/data/analyze", response_model=ToolResult, summary="表格概览 / 预览 / 列信息")
async def analyze(request: Request, body: AnalyzeRequest) -> ToolResult:
    settings = request.app.state.settings
    return await _run_tool(
        request,
        "data.analyze",
        lambda: data_tools.analyze(body, max_rows=settings.max_rows, max_bytes=settings.max_input_bytes),
    )


@router.post("/data/transform", response_model=ToolResult, summary="表格清洗与格式转换")
async def transform(request: Request, body: TransformRequest) -> ToolResult:
    settings = request.app.state.settings
    return await _run_tool(
        request,
        "data.transform",
        lambda: data_tools.transform(body, max_rows=settings.max_rows, max_bytes=settings.max_input_bytes),
    )


@router.post("/documents/parse", response_model=ToolResult, summary="PDF / DOCX / 文本解析")
async def parse_document(request: Request, body: DocumentParseRequest) -> ToolResult:
    settings = request.app.state.settings
    return await _run_tool(
        request,
        "documents.parse",
        lambda: documents.parse_document(
            body,
            max_bytes=settings.max_input_bytes,
            max_chars=settings.max_text_chars,
        ),
    )


@router.post("/text/clean", response_model=ToolResult, summary="文本清洗")
async def clean_text(request: Request, body: TextCleanRequest) -> ToolResult:
    settings = request.app.state.settings
    return await _run_tool(
        request,
        "text.clean",
        lambda: text_tools.clean_text(body, max_chars=settings.max_text_chars),
    )


@router.post("/extract", response_model=ToolResult, summary="结构化字段提取")
async def extract(request: Request, body: ExtractRequest) -> ToolResult:
    settings = request.app.state.settings
    return await _run_tool(
        request,
        "extract",
        lambda: extraction.extract(body, max_text_chars=settings.max_text_chars),
    )
