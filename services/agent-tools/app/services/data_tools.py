"""表格处理：只做预定义操作，不执行用户代码。"""

from __future__ import annotations

import base64
import binascii
import io
import math
from datetime import date, datetime
from typing import Any

import pandas as pd

from app.core.errors import ToolError
from app.schemas.tools import AnalyzeRequest, TableSource, TransformRequest

SUPPORTED_FORMATS = {"csv", "tsv", "excel"}


def decode_base64(value: str, max_bytes: int) -> bytes:
    try:
        data = base64.b64decode(value, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ToolError("invalid_base64", f"content_base64 解码失败：{exc}") from exc
    if len(data) > max_bytes:
        raise ToolError(
            "payload_too_large",
            f"输入超过上限（{max_bytes} 字节）",
            status_code=413,
        )
    return data


def infer_format(source: TableSource) -> str:
    if source.format:
        return source.format
    name = (source.filename or "").lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return "excel"
    if name.endswith(".tsv"):
        return "tsv"
    if name.endswith(".csv"):
        return "csv"
    if source.content_base64:
        return "excel"
    return "csv"


def read_table(
    source: TableSource,
    *,
    max_rows: int,
    max_bytes: int,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """读取表格；超出 max_rows 时截断并标记 truncated。"""
    fmt = infer_format(source)
    if fmt not in SUPPORTED_FORMATS:
        raise ToolError("unsupported_format", f"不支持的表格格式：{fmt}")

    limit = min(source.max_rows or max_rows, max_rows)

    try:
        if fmt == "excel":
            if not source.content_base64:
                raise ToolError("invalid_input", "Excel 需要提供 content_base64")
            data = decode_base64(source.content_base64, max_bytes)
            frame = pd.read_excel(
                io.BytesIO(data),
                sheet_name=source.sheet if source.sheet is not None else 0,
                nrows=limit + 1,
            )
        else:
            if not source.content:
                raise ToolError("invalid_input", "CSV/TSV 需要提供 content 文本")
            if len(source.content.encode("utf-8")) > max_bytes:
                raise ToolError("payload_too_large", "文本内容超过上限", status_code=413)
            sep = "\t" if fmt == "tsv" else ","
            frame = pd.read_csv(io.StringIO(source.content), sep=sep, nrows=limit + 1)
    except ToolError:
        raise
    except Exception as exc:  # pandas 的解析异常类型很多，统一转成可读错误
        raise ToolError("parse_failed", f"表格解析失败：{exc}") from exc

    truncated = len(frame) > limit
    if truncated:
        frame = frame.head(limit)

    return frame, {"format": fmt, "truncated": truncated, "rows_scanned": int(len(frame))}


def jsonable(value: Any) -> Any:
    """把 pandas/numpy 值转成 JSON 安全类型。"""
    if value is None:
        return None
    if isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int,)):
        return int(value)
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else float(value)
    if isinstance(value, (datetime, date, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if hasattr(value, "item"):
        try:
            return jsonable(value.item())
        except (ValueError, AttributeError):
            pass
    return str(value)


def records(frame: pd.DataFrame, limit: int) -> list[dict[str, Any]]:
    subset = frame.head(limit)
    return [{str(k): jsonable(v) for k, v in row.items()} for row in subset.to_dict(orient="records")]


def _require_column(frame: pd.DataFrame, column: str) -> None:
    if column not in frame.columns:
        raise ToolError(
            "column_not_found",
            f"列不存在：{column}",
            details={"available": [str(c) for c in frame.columns][:50]},
        )


def analyze(request: AnalyzeRequest, *, max_rows: int, max_bytes: int) -> dict[str, Any]:
    frame, meta = read_table(request, max_rows=max_rows, max_bytes=max_bytes)

    payload: dict[str, Any] = {
        "rows": int(len(frame)),
        "columns_count": int(len(frame.columns)),
        "format": meta["format"],
        "truncated": meta["truncated"],
    }

    if request.operation in ("summary", "columns"):
        payload["columns"] = [
            {
                "name": str(name),
                "dtype": str(dtype),
                "nulls": int(frame[name].isna().sum()),
                "unique": int(frame[name].nunique(dropna=True)),
            }
            for name, dtype in frame.dtypes.items()
        ]

    if request.operation == "summary":
        numeric = frame.select_dtypes(include="number")
        if not numeric.empty:
            described = numeric.describe().to_dict()
            payload["numeric_summary"] = {
                str(column): {str(stat): jsonable(value) for stat, value in stats.items()}
                for column, stats in described.items()
            }
        else:
            payload["numeric_summary"] = {}

    if request.operation in ("summary", "preview"):
        payload["preview"] = records(frame, request.preview_rows)

    return payload, meta


def apply_operations(frame: pd.DataFrame, request: TransformRequest) -> pd.DataFrame:
    result = frame

    for op in request.operations:
        if op.type == "dropna":
            subset = op.subset
            if subset:
                for column in subset:
                    _require_column(result, column)
            result = result.dropna(subset=subset)
        elif op.type == "fillna":
            _require_column(result, op.column)
            result = result.assign(**{op.column: result[op.column].fillna(op.value)})
        elif op.type == "filter":
            _require_column(result, op.column)
            series = result[op.column]
            if op.op in ("gt", "gte", "lt", "lte"):
                numeric = pd.to_numeric(series, errors="coerce")
                threshold = pd.to_numeric(pd.Series([op.value]), errors="coerce").iloc[0]
                if pd.isna(threshold):
                    raise ToolError("invalid_filter", f"过滤值不是数字：{op.value}")
                comparisons = {
                    "gt": numeric > threshold,
                    "gte": numeric >= threshold,
                    "lt": numeric < threshold,
                    "lte": numeric <= threshold,
                }
                result = result[comparisons[op.op].fillna(False)]
            elif op.op == "eq":
                result = result[series == op.value]
            elif op.op == "ne":
                result = result[series != op.value]
            elif op.op == "contains":
                result = result[series.astype(str).str.contains(str(op.value), case=False, regex=False)]
            elif op.op == "in":
                values = op.value if isinstance(op.value, list) else [op.value]
                result = result[series.isin(values)]
        elif op.type == "select":
            for column in op.columns:
                _require_column(result, column)
            result = result[op.columns]
        elif op.type == "sort":
            _require_column(result, op.column)
            result = result.sort_values(by=op.column, ascending=op.ascending, kind="stable")
        elif op.type == "dedupe":
            subset = op.columns
            if subset:
                for column in subset:
                    _require_column(result, column)
            result = result.drop_duplicates(subset=subset)
        elif op.type == "rename":
            for source in op.mapping:
                _require_column(result, source)
            result = result.rename(columns=op.mapping)
        elif op.type == "limit":
            result = result.head(op.rows)

    return result


def transform(request: TransformRequest, *, max_rows: int, max_bytes: int) -> dict[str, Any]:
    frame, meta = read_table(request, max_rows=max_rows, max_bytes=max_bytes)
    result = apply_operations(frame, request)

    payload: dict[str, Any] = {
        "rows": int(len(result)),
        "columns": [str(c) for c in result.columns],
        "format": meta["format"],
        "truncated": meta["truncated"] or len(result) > request.output_limit,
    }

    if request.output_format == "csv":
        payload["csv"] = result.head(request.output_limit).to_csv(index=False)
    else:
        payload["records"] = records(result, request.output_limit)

    return payload, meta
