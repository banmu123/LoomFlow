"""Uvicorn 入口：uv run uvicorn app.main:app

生产环境缺少 internal service token 时，create_app() 会抛错并阻止进程启动。
"""

from __future__ import annotations

from app.factory import create_app

app = create_app()
