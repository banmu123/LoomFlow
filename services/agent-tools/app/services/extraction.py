"""结构化提取：预定义字段类型 + 关键词-值抓取，不接受自定义正则。"""

from __future__ import annotations

import re
from typing import Any

from app.core.errors import ToolError
from app.schemas.tools import ExtractField, ExtractRequest

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_URL = re.compile(r"https?://[^\s<>\"'）)\]]+")
_DATE = re.compile(
    r"\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?"
    r"|\d{1,2}/\d{1,2}/\d{4}"
)
_NUMBER = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?")
_MONEY = re.compile(r"[¥$€£￥]\s?\d[\d,]*(?:\.\d+)?")


def _dedupe(values: list[str], limit: int) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        cleaned = value.strip().rstrip(".,;，。；")
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        output.append(cleaned)
        if len(output) >= limit:
            break
    return output


def _extract_field(text: str, field: ExtractField, limit: int) -> list[str]:
    if field.type == "email":
        return _dedupe(_EMAIL.findall(text), limit)
    if field.type == "url":
        return _dedupe(_URL.findall(text), limit)
    if field.type == "date":
        return _dedupe(_DATE.findall(text), limit)
    if field.type == "number":
        return _dedupe(_NUMBER.findall(text), limit)
    if field.type == "money":
        return _dedupe(_MONEY.findall(text), limit)

    # key_value：必须显式给出 label，避免用任意正则扫描
    if not field.label:
        raise ToolError(
            "invalid_field",
            f"字段 {field.name} 为 key_value 类型时必须提供 label",
        )
    pattern = re.compile(
        rf"{re.escape(field.label)}\s*[:：]\s*([^\n\r，,；;]{{1,80}})",
        re.IGNORECASE,
    )
    return _dedupe([match.group(1) for match in pattern.finditer(text)], limit)


def extract(request: ExtractRequest, *, max_text_chars: int) -> tuple[dict[str, Any], dict[str, Any]]:
    text = request.text[:max_text_chars]
    truncated = len(request.text) > max_text_chars

    values: dict[str, list[str]] = {}
    missing: list[str] = []

    for field in request.fields:
        found = _extract_field(text, field, request.limit)
        values[field.name] = found
        if field.required and not found:
            missing.append(field.name)

    if missing:
        raise ToolError(
            "required_field_missing",
            f"必填字段未提取到内容：{', '.join(missing)}",
            status_code=422,
            details={"missing": missing},
        )

    return (
        {
            "fields": values,
            "counts": {name: len(items) for name, items in values.items()},
        },
        {"chars_scanned": len(text), "truncated": truncated},
    )
