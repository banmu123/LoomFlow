from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

from app import __version__


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["environment"] == "test"
    assert body["service"] == "LoomFlow Knowledge AI"


def test_health_timestamp_is_iso8601_utc(client: TestClient) -> None:
    body = client.get("/health").json()

    parsed = datetime.fromisoformat(body["timestamp"].replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    assert parsed.utcoffset().total_seconds() == 0


def test_health_is_reachable_without_service_token(client: TestClient) -> None:
    # 容器探针不带密钥；该端点不暴露业务数据
    assert client.get("/health").status_code == 200


def test_health_echoes_incoming_request_id(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "req-from-node"})

    assert response.headers["X-Request-Id"] == "req-from-node"


def test_health_generates_request_id(client: TestClient) -> None:
    request_id = client.get("/health").headers["X-Request-Id"]

    assert len(request_id) == 32
    int(request_id, 16)  # 合法的 uuid4 hex


def test_health_does_not_leak_secrets(client: TestClient) -> None:
    body = client.get("/health").text

    assert "test-service-token" not in body
