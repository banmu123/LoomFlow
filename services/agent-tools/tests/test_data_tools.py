from __future__ import annotations

import base64
import io
from collections.abc import Callable

import pandas as pd
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app

ANALYZE_URL = "/api/v1/tools/data/analyze"
TRANSFORM_URL = "/api/v1/tools/data/transform"

CSV = "name,amount,region\nA,10,east\nB,20,west\nC,30,east\n"


def test_analyze_summary(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        ANALYZE_URL,
        json={"content": CSV, "filename": "orders.csv", "operation": "summary"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["rows"] == 3
    assert data["columns_count"] == 3
    assert data["numeric_summary"]["amount"]["mean"] == 20
    assert {c["name"] for c in data["columns"]} == {"name", "amount", "region"}
    assert len(data["preview"]) == 3
    assert body["metadata"]["tool"] == "data.analyze"


def test_analyze_preview_only(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        ANALYZE_URL,
        json={"content": CSV, "operation": "preview", "preview_rows": 2},
        headers=auth_headers,
    )
    body = response.json()
    assert len(body["data"]["preview"]) == 2
    assert "numeric_summary" not in body["data"]


def test_analyze_excel_base64(client: TestClient, auth_headers: dict[str, str]) -> None:
    buffer = io.BytesIO()
    pd.DataFrame({"sku": ["a", "b"], "qty": [1, 5]}).to_excel(buffer, index=False)
    encoded = base64.b64encode(buffer.getvalue()).decode()

    response = client.post(
        ANALYZE_URL,
        json={"content_base64": encoded, "filename": "stock.xlsx", "operation": "summary"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["rows"] == 2
    assert data["format"] == "excel"
    assert data["numeric_summary"]["qty"]["max"] == 5


def test_transform_filter_and_select(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        TRANSFORM_URL,
        json={
            "content": CSV,
            "operations": [
                {"type": "filter", "column": "amount", "op": "gt", "value": 15},
                {"type": "select", "columns": ["name", "amount"]},
                {"type": "sort", "column": "amount", "ascending": False},
            ],
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["rows"] == 2
    assert data["columns"] == ["name", "amount"]
    assert [r["name"] for r in data["records"]] == ["C", "B"]


def test_transform_csv_output(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        TRANSFORM_URL,
        json={
            "content": CSV,
            "operations": [{"type": "dedupe", "columns": ["region"]}],
            "output_format": "csv",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["data"]["csv"].startswith("name,amount,region")


def test_transform_unknown_column(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        TRANSFORM_URL,
        json={
            "content": CSV,
            "operations": [{"type": "select", "columns": ["missing"]}],
        },
        headers=auth_headers,
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "column_not_found"
    assert "name" in body["error"]["details"]["available"]


def test_rejects_both_sources(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        ANALYZE_URL,
        json={"content": CSV, "content_base64": "AAAA"},
        headers=auth_headers,
    )
    assert response.status_code == 422


def test_invalid_base64(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        ANALYZE_URL,
        json={"content_base64": "not-base64-@@", "filename": "x.xlsx"},
        headers=auth_headers,
    )
    # 非法 base64 可能被宽松解码后解析失败，两种错误都必须显式返回
    assert response.status_code in (400,)


def test_payload_limit(make_settings: Callable[..., Settings], auth_headers: dict[str, str]) -> None:
    with TestClient(create_app(make_settings(max_input_bytes=8))) as app_client:
        response = app_client.post(
            ANALYZE_URL,
            json={"content": CSV},
            headers=auth_headers,
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_row_limit_truncates(
    make_settings: Callable[..., Settings], auth_headers: dict[str, str]
) -> None:
    with TestClient(create_app(make_settings(max_rows=2))) as app_client:
        response = app_client.post(
            ANALYZE_URL,
            json={"content": CSV, "operation": "preview"},
            headers=auth_headers,
        )

    body = response.json()
    assert body["data"]["rows"] == 2
    assert body["metadata"]["truncated"] is True
