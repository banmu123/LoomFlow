"""python -m app：按配置启动 uvicorn（Docker 镜像的默认入口）。"""

from __future__ import annotations

import sys

import uvicorn
from pydantic import ValidationError

from app.core.config import get_settings


def main() -> None:
    try:
        settings = get_settings()
    except ValidationError as exc:
        # 生产配置不合法时给出一行可读原因，避免整屏堆栈淹没真实问题
        reasons = "; ".join(str(error["msg"]) for error in exc.errors())
        print(
            f"[loomflow-ai] invalid configuration, refusing to start: {reasons}",
            file=sys.stderr,
        )
        raise SystemExit(1) from None

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
        server_header=False,
    )


if __name__ == "__main__":
    main()
