"""Uvicorn 入口。"""

from __future__ import annotations

from app.factory import create_app

app = create_app()
