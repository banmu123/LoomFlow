from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app


def test_unknown_route_returns_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "Not Found"},
    }


def test_validation_error_returns_details(make_settings: Callable[..., Settings]) -> None:
    app = create_app(make_settings())

    @app.get("/_test/validate")
    async def validate(limit: int) -> dict[str, int]:
        return {"limit": limit}

    with TestClient(app) as client:
        response = client.get("/_test/validate", params={"limit": "abc"})

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"][0]["location"] == ["query", "limit"]


def test_unhandled_error_hides_internals(make_settings: Callable[..., Settings]) -> None:
    app = create_app(make_settings())

    @app.get("/_test/boom")
    async def boom() -> dict[str, str]:
        raise RuntimeError("connection string postgres://user:secret@db")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/_test/boom")

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error"},
    }
    assert "secret" not in response.text
    assert "RuntimeError" not in response.text


def test_protected_route_uses_same_error_shape(client: TestClient) -> None:
    response = client.get("/api/v1/knowledge/capabilities")

    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
