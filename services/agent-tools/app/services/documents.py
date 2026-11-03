"""文档解析：PDF / DOCX / 纯文本。只做解析，不做网络请求或宏执行。"""

from __future__ import annotations

import io
from typing import Any

from app.core.errors import ToolError
from app.schemas.tools import DocumentParseRequest
from app.services.data_tools import decode_base64


def _file_type(filename: str | None) -> str:
    name = (filename or "").lower()
    for suffix, kind in ((".pdf", "pdf"), (".docx", "docx"), (".md", "markdown"), (".txt", "text")):
        if name.endswith(suffix):
            return kind
    return "text"


def _parse_pdf(data: bytes) -> tuple[str, int]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - 依赖缺失时给出明确原因
        raise ToolError("parser_unavailable", "PDF 解析依赖未安装", status_code=503) from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise ToolError("encrypted_document", "PDF 已加密，无法解析") from exc

        pages: list[str] = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return "\n\n".join(pages).strip(), len(reader.pages)
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError("parse_failed", f"PDF 解析失败：{exc}") from exc


def _parse_docx(data: bytes) -> tuple[str, int | None]:
    try:
        from docx import Document
    except ImportError as exc:  # pragma: no cover
        raise ToolError("parser_unavailable", "DOCX 解析依赖未安装", status_code=503) from exc

    try:
        document = Document(io.BytesIO(data))
        blocks: list[str] = [p.text for p in document.paragraphs if p.text.strip()]
        for table in document.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    blocks.append(" | ".join(cells))
        return "\n".join(blocks).strip(), None
    except Exception as exc:
        raise ToolError("parse_failed", f"DOCX 解析失败：{exc}") from exc


def parse_document(
    request: DocumentParseRequest,
    *,
    max_bytes: int,
    max_chars: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    limit = min(request.max_chars or max_chars, max_chars)
    file_type = _file_type(request.filename)

    if request.content is not None:
        text = request.content
        pages: int | None = None
    else:
        data = decode_base64(request.content_base64 or "", max_bytes)

        if data.startswith(b"%PDF"):
            file_type = "pdf"
            text, pages = _parse_pdf(data)
        elif data[:2] == b"PK" and file_type == "docx":
            text, pages = _parse_docx(data)
        else:
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                text = data.decode("utf-8", errors="replace")
            pages = None

    truncated = len(text) > limit
    if truncated:
        text = text[:limit]

    return (
        {
            "text": text,
            "chars": len(text),
            "pages": pages,
            "file_type": file_type,
            "truncated": truncated,
        },
        {"chars_scanned": len(text)},
    )
