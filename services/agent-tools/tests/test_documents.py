from __future__ import annotations

import base64
import io
from collections.abc import Callable

from docx import Document
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.factory import create_app

PARSE_URL = "/api/v1/tools/documents/parse"


def test_parse_plain_text(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        PARSE_URL,
        json={"content": "# 标题\n正文", "filename": "note.md"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["file_type"] == "markdown"
    assert data["text"].startswith("# 标题")
    assert data["pages"] is None


def test_parse_docx(client: TestClient, auth_headers: dict[str, str]) -> None:
    document = Document()
    document.add_paragraph("第一段")
    document.add_paragraph("第二段")
    table = document.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "列一"
    table.cell(0, 1).text = "列二"

    buffer = io.BytesIO()
    document.save(buffer)
    encoded = base64.b64encode(buffer.getvalue()).decode()

    response = client.post(
        PARSE_URL,
        json={"content_base64": encoded, "filename": "report.docx"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["file_type"] == "docx"
    assert "第一段" in data["text"]
    assert "列一 | 列二" in data["text"]


def test_parse_invalid_pdf_is_explicit(client: TestClient, auth_headers: dict[str, str]) -> None:
    encoded = base64.b64encode(b"%PDF-1.4 broken").decode()
    response = client.post(
        PARSE_URL,
        json={"content_base64": encoded, "filename": "broken.pdf"},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] in {"parse_failed", "encrypted_document"}


def test_parse_truncates_long_text(
    make_settings: Callable[..., Settings], auth_headers: dict[str, str]
) -> None:
    with TestClient(create_app(make_settings(max_text_chars=1000))) as app_client:
        response = app_client.post(
            PARSE_URL,
            json={"content": "x" * 5000, "filename": "big.txt"},
            headers=auth_headers,
        )

    data = response.json()["data"]
    assert data["chars"] == 1000
    assert data["truncated"] is True


def test_requires_exactly_one_source(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(PARSE_URL, json={}, headers=auth_headers)
    assert response.status_code == 422
