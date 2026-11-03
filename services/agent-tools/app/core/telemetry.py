"""OpenTelemetry：FastAPI 服务端 Span + W3C Trace Context 传播。

未配置 OTEL_ENABLED=true 时保持 no-op（仅创建不记录的 Span）。
"""

from __future__ import annotations

import os
import re

from fastapi import FastAPI, Request
from opentelemetry import trace
from opentelemetry.propagate import extract
from opentelemetry.trace import SpanKind, Status, StatusCode

TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")

_initialised = False


def parse_traceparent(value: str | None) -> dict[str, str] | None:
    """解析 W3C traceparent；非法返回 None（不做兼容猜测）。"""
    if not value:
        return None
    match = TRACEPARENT.match(value.strip())
    if not match:
        return None
    trace_id, span_id, flags = match.groups()
    if set(trace_id) == {"0"} or set(span_id) == {"0"}:
        return None
    return {"traceparent": f"00-{trace_id}-{span_id}-{flags}"}


def init_telemetry(service_name: str = "loomflow-agent-tools") -> bool:
    """按环境变量初始化 OTLP 导出；未启用或缺少 endpoint 时返回 False。"""
    global _initialised
    if _initialised:
        return True
    if os.getenv("OTEL_ENABLED", "").lower() != "true":
        return False

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
    traces_endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or (
        f"{endpoint}/v1/traces" if endpoint else ""
    )
    if not traces_endpoint:
        return False

    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import SERVICE_NAME, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({SERVICE_NAME: service_name}))
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=traces_endpoint))
        )
        trace.set_tracer_provider(provider)
        _initialised = True
        return True
    except Exception as exc:  # pragma: no cover - 依赖缺失时不应阻断服务
        print(f"[telemetry] 初始化失败，降级为 no-op：{exc}")
        return False


def instrument_fastapi(app: FastAPI, service_name: str = "loomflow-agent-tools") -> None:
    """注册 HTTP 中间件：恢复上游 traceparent，并为每个请求创建 SERVER Span。"""
    init_telemetry(service_name)
    tracer = trace.get_tracer(service_name)

    @app.middleware("http")
    async def otel_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        carrier = {}
        traceparent = request.headers.get("traceparent")
        if parse_traceparent(traceparent):
            carrier["traceparent"] = traceparent

        parent_context = extract(carrier)
        span_name = f"{request.method} {request.url.path}"

        with tracer.start_as_current_span(
            span_name,
            context=parent_context,
            kind=SpanKind.SERVER,
        ) as span:
            span.set_attribute("http.method", request.method)
            span.set_attribute("http.request.method", request.method)
            span.set_attribute("http.route", request.url.path)
            span.set_attribute("url.path", request.url.path)
            try:
                response = await call_next(request)
                span.set_attribute("http.status_code", response.status_code)
                span.set_attribute("http.response.status_code", response.status_code)
                return response
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
                raise
