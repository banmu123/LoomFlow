from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.core.config import Settings
from app.core.telemetry import parse_traceparent
from app.factory import create_app

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN_ID = "00f067aa0ba902b7"

_exporter = InMemorySpanExporter()
_provider = TracerProvider()
_provider.add_span_processor(SimpleSpanProcessor(_exporter))
trace.set_tracer_provider(_provider)


def test_parse_traceparent() -> None:
    assert parse_traceparent(f"00-{TRACE_ID}-{SPAN_ID}-01") == {
        "traceparent": f"00-{TRACE_ID}-{SPAN_ID}-01"
    }
    assert parse_traceparent(None) is None
    assert parse_traceparent("garbage") is None
    assert parse_traceparent("00-" + "0" * 32 + "-" + SPAN_ID + "-01") is None


def test_http_span_continues_upstream_trace(
    make_settings: Callable[..., Settings], auth_headers: dict[str, str]
) -> None:
    _exporter.clear()
    with TestClient(create_app(make_settings())) as client:
        response = client.get(
            "/health",
            headers={"traceparent": f"00-{TRACE_ID}-{SPAN_ID}-01"},
        )

    assert response.status_code == 200
    spans = [span for span in _exporter.get_finished_spans() if span.name.startswith("GET /health")]
    assert spans, "应导出 HTTP SERVER Span"
    span = spans[-1]
    assert format(span.context.trace_id, "032x") == TRACE_ID
    status = span.attributes.get("http.status_code") or span.attributes.get(
        "http.response.status_code"
    )
    assert status == 200
    assert span.attributes.get("http.route") == "/health"


def test_invalid_traceparent_still_serves(
    make_settings: Callable[..., Settings],
) -> None:
    with TestClient(create_app(make_settings())) as client:
        response = client.get("/health", headers={"traceparent": "invalid"})
    assert response.status_code == 200
