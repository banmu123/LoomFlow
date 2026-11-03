"""python -m app：按配置启动 uvicorn。"""

from __future__ import annotations

import sys

import uvicorn
from pydantic import ValidationError

from app.core.config import get_settings


def main() -> None:
    try:
        settings = get_settings()
    except ValidationError as exc:
        reasons = "; ".join(str(error["msg"]) for error in exc.errors())
        print(f"[loomflow-agent-tools] invalid configuration: {reasons}", file=sys.stderr)
        raise SystemExit(1) from None

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8090,
        proxy_headers=True,
        server_header=False,
    )


if __name__ == "__main__":
    main()
