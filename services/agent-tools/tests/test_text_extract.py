from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app

CLEAN_URL = "/api/v1/tools/text/clean"
EXTRACT_URL = "/api/v1/tools/extract"


def test_clean_strips_html_and_scripts(client: TestClient, auth_headers: dict[str, str]) -> None:
    html = "<html><script>alert(1)</script><body><h1>标题</h1><p>正文  内容</p></body></html>"
    response = client.post(CLEAN_URL, json={"text": html}, headers=auth_headers)

    assert response.status_code == 200
    text = response.json()["data"]["text"]
    assert "alert(1)" not in text
    assert "标题" in text
    assert "<p>" not in text


def test_clean_dedupes_lines(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        CLEAN_URL,
        json={"text": "a\nb\na\n\n\n\nb", "operations": ["dedupe_lines", "normalize_whitespace"]},
        headers=auth_headers,
    )
    assert response.json()["data"]["text"] == "a\nb"


def test_extract_common_fields(client: TestClient, auth_headers: dict[str, str]) -> None:
    text = "联系 alice@example.com，订单金额 ¥1,299.00，下单日期 2026-10-31，地址 https://example.com/order/1"
    response = client.post(
        EXTRACT_URL,
        json={
            "text": text,
            "fields": [
                {"name": "email", "type": "email"},
                {"name": "money", "type": "money"},
                {"name": "date", "type": "date"},
                {"name": "link", "type": "url"},
            ],
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    fields = response.json()["data"]["fields"]
    assert fields["email"] == ["alice@example.com"]
    assert fields["money"] == ["¥1,299.00"]
    assert fields["date"] == ["2026-10-31"]
    assert fields["link"] == ["https://example.com/order/1"]


def test_extract_key_value(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        EXTRACT_URL,
        json={
            "text": "订单号：A-1024\n客户：张三",
            "fields": [{"name": "order", "type": "key_value", "label": "订单号"}],
        },
        headers=auth_headers,
    )
    assert response.json()["data"]["fields"]["order"] == ["A-1024"]


def test_extract_required_missing(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        EXTRACT_URL,
        json={"text": "没有邮箱", "fields": [{"name": "email", "type": "email", "required": True}]},
        headers=auth_headers,
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "required_field_missing"
    assert body["error"]["details"]["missing"] == ["email"]


def test_extract_key_value_requires_label(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        EXTRACT_URL,
        json={"text": "x", "fields": [{"name": "x", "type": "key_value"}]},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_field"


def test_tool_timeout_returns_504(
    make_settings: Callable[..., Settings], auth_headers: dict[str, str]
) -> None:
    with TestClient(create_app(make_settings(tool_timeout_seconds=0.001))) as app_client:
        response = app_client.post(
            CLEAN_URL,
            json={"text": "hello world"},
            headers=auth_headers,
        )

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "timeout"
