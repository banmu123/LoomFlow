from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.security import tokens_match
from app.factory import create_app

CAPABILITIES_URL = "/api/v1/knowledge/capabilities"


def test_missing_token_is_rejected(client: TestClient) -> None:
    response = client.get(CAPABILITIES_URL)

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "unauthorized"
    assert body["error"]["message"] == "Invalid or missing service token"


def test_wrong_token_is_rejected(client: TestClient) -> None:
    response = client.get(
        CAPABILITIES_URL,
        headers={"X-Loomflow-Service-Token": "not-the-right-token"},
    )

    assert response.status_code == 401


def test_token_of_different_length_is_rejected(client: TestClient) -> None:
    response = client.get(
        CAPABILITIES_URL,
        headers={"X-Loomflow-Service-Token": "short"},
    )

    assert response.status_code == 401


def test_valid_token_grants_access(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get(CAPABILITIES_URL, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "fastapi"
    assert body["stage"] == "skeleton"
    # M1 未实现检索能力，能力位必须为 false，避免上层误判
    assert body["features"] == {
        "document_parsing": False,
        "chunking": False,
        "embedding": False,
        "vector_search": False,
        "hybrid_search": False,
        "rerank": False,
    }


def test_unconfigured_token_fails_closed(make_settings: Callable[..., Settings]) -> None:
    # 开发环境允许不配密钥，但受保护路由必须拒绝服务而不是放行
    with TestClient(create_app(make_settings(knowledge_service_token=None))) as client:
        response = client.get(CAPABILITIES_URL, headers={"X-Loomflow-Service-Token": "anything"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


@pytest.mark.parametrize(
    ("provided", "expected", "should_match"),
    [
        ("same-token", "same-token", True),
        ("same-token", "other-token", False),
        (None, "expected", False),
        ("provided", None, False),
        ("", "", False),
    ],
)
def test_tokens_match(provided: str | None, expected: str | None, should_match: bool) -> None:
    assert tokens_match(provided, expected) is should_match


def test_production_requires_token() -> None:
    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None, app_env="production", knowledge_service_token=None)

    assert "KNOWLEDGE_SERVICE_TOKEN is required" in str(excinfo.value)


def test_production_rejects_weak_token() -> None:
    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None, app_env="production", knowledge_service_token="too-short")

    assert "at least 16 characters" in str(excinfo.value)


def test_production_accepts_strong_token() -> None:
    settings = Settings(
        _env_file=None,
        app_env="production",
        knowledge_service_token="a" * 32,
    )

    assert settings.app_env.value == "production"
    assert settings.service_token == "a" * 32


def test_blank_token_is_treated_as_missing() -> None:
    settings = Settings(_env_file=None, app_env="development", knowledge_service_token="   ")

    assert settings.knowledge_service_token is None
    assert settings.service_token is None


def test_token_is_not_rendered_in_settings_repr() -> None:
    settings = Settings(_env_file=None, knowledge_service_token="super-secret-token-value")

    # SecretStr 在 repr / 序列化中隐藏明文
    assert "super-secret-token-value" not in repr(settings)
    assert "super-secret-token-value" not in settings.model_dump_json()
