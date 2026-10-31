from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app

TEST_TOKEN = "test-service-token-0123456789"
AUTH_HEADER_NAME = "X-Loomflow-Service-Token"


@pytest.fixture
def make_settings() -> Callable[..., Settings]:
    """构造测试配置：禁用 .env 读取，避免本机环境影响断言。"""

    def _make(**overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "_env_file": None,
            "app_env": "test",
            "knowledge_service_token": TEST_TOKEN,
            "log_level": "WARNING",
        }
        values.update(overrides)
        return Settings(**values)

    return _make


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {AUTH_HEADER_NAME: TEST_TOKEN}


@pytest.fixture
def client(make_settings: Callable[..., Settings]) -> Iterator[TestClient]:
    with TestClient(create_app(make_settings())) as test_client:
        yield test_client
