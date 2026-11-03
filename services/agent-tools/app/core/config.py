"""服务配置：全部来自环境变量，生产环境强制要求内部服务密钥。"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MIN_SERVICE_TOKEN_LENGTH = 16


class AppEnv(str, Enum):
    development = "development"
    test = "test"
    production = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "LoomFlow Agent Tools"
    app_env: AppEnv = AppEnv.development
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"

    knowledge_service_token: SecretStr | None = None
    enable_docs: bool = True

    # 单次工具调用的服务端超时（秒）；请求可指定更小值
    tool_timeout_seconds: float = 25.0
    # 输入体积上限（解码后字节数）
    max_input_bytes: int = 8 * 1024 * 1024
    # 表格最大处理行数，防止一次请求吃满内存
    max_rows: int = 200_000
    # 文本最大字符数
    max_text_chars: int = 400_000
    # 预览行数上限
    max_preview_rows: int = 100

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, value: str) -> str:
        level = value.strip().upper()
        if level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise ValueError("LOG_LEVEL must be one of CRITICAL/ERROR/WARNING/INFO/DEBUG")
        return level

    @field_validator("api_prefix")
    @classmethod
    def _normalise_prefix(cls, value: str) -> str:
        prefix = "/" + value.strip().strip("/")
        return "" if prefix == "/" else prefix

    @field_validator("knowledge_service_token", mode="before")
    @classmethod
    def _blank_token_is_missing(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def _enforce_production_requirements(self) -> "Settings":
        if self.app_env is not AppEnv.production:
            return self
        if self.knowledge_service_token is None:
            raise ValueError(
                "KNOWLEDGE_SERVICE_TOKEN is required when APP_ENV=production"
            )
        if len(self.knowledge_service_token.get_secret_value()) < MIN_SERVICE_TOKEN_LENGTH:
            raise ValueError(
                f"KNOWLEDGE_SERVICE_TOKEN must be at least {MIN_SERVICE_TOKEN_LENGTH} characters"
            )
        return self

    @property
    def service_token(self) -> str | None:
        return self.knowledge_service_token.get_secret_value() if self.knowledge_service_token else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
