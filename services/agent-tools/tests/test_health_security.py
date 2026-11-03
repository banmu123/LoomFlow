from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.factory import create_app

TOOL_URL = "/api/v1/tools/text/clean"


def test_health_and_readiness(client: TestClient) -> None:
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    ready = client.get("/ready")
    assert ready.status_code == 200
    body = ready.json()
    assert body["ready"] is True
    assert body["checks"] == {"pandas": True, "pdf": True, "docx": True}


def test_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "req-123"})
    assert response.headers["X-Request-Id"] == "req-123"


def test_tool_requires_token(client: TestClient) -> None:
    response = client.post(TOOL_URL, json={"text": "hello"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_unconfigured_token_fails_closed(make_settings: Callable[..., Settings]) -> None:
    with TestClient(create_app(make_settings(knowledge_service_token=None))) as app_client:
        response = app_client.post(
            TOOL_URL,
            json={"text": "hello"},
            headers={"X-Loomflow-Service-Token": "anything"},
        )
    assert response.status_code == 503


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not Found"}}


def test_validation_error_envelope(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(TOOL_URL, json={"text": ""}, headers=auth_headers)
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"]


def test_production_requires_token() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", knowledge_service_token=None)


def test_production_rejects_short_token() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", knowledge_service_token="short")
