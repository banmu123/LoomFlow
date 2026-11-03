"""工具接口的请求/响应模型（Pydantic 2）。

设计原则：
- 所有输入显式声明，拒绝未定义字段（防参数走私）
- 不提供"执行任意代码/任意正则"的入口
- 输出统一为 {success, data, metadata}
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, model_validator

TableFormat = Literal["csv", "tsv", "excel"]


class TableSource(BaseModel):
    """表格输入：文本（csv/tsv）或 base64（xlsx）二选一。"""

    content: str | None = Field(default=None, description="CSV/TSV 文本内容")
    content_base64: str | None = Field(default=None, description="Excel 等二进制内容的 base64")
    filename: str | None = Field(default=None, description="用于推断格式，如 orders.xlsx")
    format: TableFormat | None = Field(default=None, description="显式指定格式，缺省按 filename/内容推断")
    sheet: str | int | None = Field(default=None, description="Excel 工作表名或索引")
    max_rows: int | None = Field(default=None, ge=1, le=200_000, description="最多读取行数")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "TableSource":
        provided = [bool(self.content), bool(self.content_base64)]
        if sum(provided) != 1:
            raise ValueError("content 与 content_base64 必须且只能提供一个")
        return self


class AnalyzeRequest(TableSource):
    operation: Literal["summary", "preview", "columns"] = "summary"
    preview_rows: int = Field(default=10, ge=1, le=100)


class DropNaOp(BaseModel):
    type: Literal["dropna"]
    subset: list[str] | None = None


class FillNaOp(BaseModel):
    type: Literal["fillna"]
    column: str
    value: str | int | float | bool


class FilterOp(BaseModel):
    type: Literal["filter"]
    column: str
    op: Literal["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"]
    value: Any


class SelectOp(BaseModel):
    type: Literal["select"]
    columns: list[str] = Field(min_length=1, max_length=100)


class SortOp(BaseModel):
    type: Literal["sort"]
    column: str
    ascending: bool = True


class DedupeOp(BaseModel):
    type: Literal["dedupe"]
    columns: list[str] | None = None


class RenameOp(BaseModel):
    type: Literal["rename"]
    mapping: dict[str, str] = Field(min_length=1, max_length=100)


class LimitOp(BaseModel):
    type: Literal["limit"]
    rows: int = Field(ge=1, le=100_000)


TransformOperation = Annotated[
    Union[DropNaOp, FillNaOp, FilterOp, SelectOp, SortOp, DedupeOp, RenameOp, LimitOp],
    Field(discriminator="type"),
]


class TransformRequest(TableSource):
    operations: list[TransformOperation] = Field(min_length=1, max_length=20)
    output_format: Literal["json", "csv"] = "json"
    output_limit: int = Field(default=1000, ge=1, le=100_000)


class DocumentParseRequest(BaseModel):
    content: str | None = Field(default=None, description="纯文本（txt/md）")
    content_base64: str | None = Field(default=None, description="二进制文档 base64（pdf/docx）")
    filename: str | None = None
    max_chars: int | None = Field(default=None, ge=1_000, le=400_000)

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "DocumentParseRequest":
        if sum([bool(self.content), bool(self.content_base64)]) != 1:
            raise ValueError("content 与 content_base64 必须且只能提供一个")
        return self


TextCleanOperation = Literal[
    "strip_html",
    "normalize_whitespace",
    "dedupe_lines",
    "trim_empty_lines",
    "strip_control_chars",
]


class TextCleanRequest(BaseModel):
    text: str = Field(min_length=1)
    operations: list[TextCleanOperation] = Field(
        default_factory=lambda: ["strip_html", "normalize_whitespace", "trim_empty_lines"],
        min_length=1,
        max_length=5,
    )
    max_chars: int | None = Field(default=None, ge=1_000, le=400_000)


class ExtractField(BaseModel):
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
    type: Literal["email", "url", "date", "number", "money", "key_value"]
    label: str | None = Field(default=None, description="key_value 类型要抓取的字段名，如 订单号")
    required: bool = False


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1)
    fields: list[ExtractField] = Field(min_length=1, max_length=20)
    limit: int = Field(default=20, ge=1, le=100)


class ToolMetadata(BaseModel):
    tool: str
    duration_ms: int
    truncated: bool = False
    rows_scanned: int | None = None


class ToolResult(BaseModel):
    success: bool = True
    data: dict[str, Any]
    metadata: ToolMetadata


class ToolErrorDetail(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ToolErrorResponse(BaseModel):
    error: ToolErrorDetail
