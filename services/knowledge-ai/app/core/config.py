"""进程级配置：全部通过环境变量注入，不在代码中保存任何密钥。"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 生产环境内部服务密钥的最小长度（与 openssl rand -hex 32 的强度对齐）
MIN_SERVICE_TOKEN_LENGTH = 16

VALID_LOG_LEVELS = frozenset({"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"})


class AppEnv(str, Enum):
    """运行环境。production 下会启用更严格的启动校验。"""

    development = "development"
    test = "test"
    production = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # 本地开发从服务目录下的 .env 读取（Docker 场景由 environment 注入）
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "LoomFlow Knowledge AI"
    app_env: AppEnv = AppEnv.development
    log_level: str = "INFO"

    # 统一业务路由前缀；/health 作为探针刻意留在前缀之外
    api_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8000

    # 内部服务间认证密钥，请求头 X-Loomflow-Service-Token
    knowledge_service_token: SecretStr | None = None

    # 生产环境可关闭 /docs 与 /openapi.json
    enable_docs: bool = True

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, value: str) -> str:
        level = value.strip().upper()
        if level not in VALID_LOG_LEVELS:
            raise ValueError(f"LOG_LEVEL must be one of {sorted(VALID_LOG_LEVELS)}")
        return level

    @field_validator("api_prefix")
    @classmethod
    def _normalise_api_prefix(cls, value: str) -> str:
        prefix = "/" + value.strip().strip("/")
        return "" if prefix == "/" else prefix

    @field_validator("knowledge_service_token", mode="before")
    @classmethod
    def _blank_token_is_missing(cls, value: object) -> object:
        # docker compose 未填变量时注入的是空字符串，视同未配置
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def _enforce_production_requirements(self) -> "Settings":
        if self.app_env is not AppEnv.production:
            return self

        if self.knowledge_service_token is None:
            raise ValueError(
                "KNOWLEDGE_SERVICE_TOKEN is required when APP_ENV=production "
                "(the service must never run unprotected in production)"
            )

        token = self.knowledge_service_token.get_secret_value()
        if len(token) < MIN_SERVICE_TOKEN_LENGTH:
            raise ValueError(
                f"KNOWLEDGE_SERVICE_TOKEN must be at least {MIN_SERVICE_TOKEN_LENGTH} "
                "characters when APP_ENV=production"
            )
        return self

    @property
    def service_token(self) -> str | None:
        """明文密钥仅在进程内用于常量时间比较，不进入日志与响应。"""
        return self.knowledge_service_token.get_secret_value() if self.knowledge_service_token else None


@lru_cache
def get_settings() -> Settings:
    """进程级单例；测试通过 create_app(Settings(...)) 注入独立配置。"""
    return Settings()
