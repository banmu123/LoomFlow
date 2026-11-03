"""文本清洗：固定操作集，不接受正则或代码。"""

from __future__ import annotations

import re
from typing import Any

from app.schemas.tools import TextCleanRequest

_SCRIPT_STYLE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG = re.compile(r"<[^>]+>")
_INLINE_SPACE = re.compile(r"[ \t\u00a0\u3000]+")
_BLANK_LINES = re.compile(r"\n{3,}")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _strip_html(text: str) -> str:
    return _TAG.sub(" ", _SCRIPT_STYLE.sub(" ", text))


def _normalize_whitespace(text: str) -> str:
    lines = [_INLINE_SPACE.sub(" ", line).strip() for line in text.splitlines()]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def _dedupe_lines(text: str) -> str:
    seen: set[str] = set()
    output: list[str] = []
    for line in text.splitlines():
        key = line.strip()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        output.append(line)
    return "\n".join(output)


def _trim_empty_lines(text: str) -> str:
    return text.strip("\n")


def clean_text(request: TextCleanRequest, *, max_chars: int) -> tuple[dict[str, Any], dict[str, Any]]:
    text = request.text
    applied: list[str] = []

    for operation in request.operations:
        if operation == "strip_html":
            text = _strip_html(text)
        elif operation == "normalize_whitespace":
            text = _normalize_whitespace(text)
        elif operation == "dedupe_lines":
            text = _dedupe_lines(text)
        elif operation == "trim_empty_lines":
            text = _trim_empty_lines(text)
        elif operation == "strip_control_chars":
            text = _CONTROL.sub("", text)
        applied.append(operation)

    limit = min(request.max_chars or max_chars, max_chars)
    truncated = len(text) > limit
    if truncated:
        text = text[:limit]

    return (
        {"text": text, "chars": len(text), "truncated": truncated, "operations": applied},
        {"chars_scanned": len(request.text)},
    )
