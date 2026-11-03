# LoomFlow Code Sandbox

LoomFlow Code Node 的独立执行服务：接收 JSON 请求，在受限子进程中执行 JavaScript，返回 JSON 结果。

- 不暴露公网，只接受内部网络调用
- 不挂载 Docker Socket，不做嵌套容器
- 非 root、只读根文件系统、`cap_drop ALL`、PID/内存/CPU 限制
- 沙箱不可用时上层**失败关闭**，不回退 `node:vm`

安全设计与残余风险：[docs/config/code-sandbox.md](../../docs/config/code-sandbox.md)

## 本地运行

```bash
cd services/code-sandbox
SANDBOX_RUNNER_TOKEN=local-test-token PORT=8090 node runner.js
```

```bash
curl -s http://127.0.0.1:8090/health
curl -s -X POST http://127.0.0.1:8090/execute \
  -H 'content-type: application/json' \
  -H 'x-loomflow-sandbox-token: local-test-token' \
  -d '{"code":"return {sum: inputs.a + inputs.b};","inputs":{"a":20,"b":22},"timeoutMs":2000}'
# {"ok":true,"result":{"sum":42}}
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8090` | 监听端口 |
| `SANDBOX_RUNNER_TOKEN` | 空 | 内部密钥；为空时所有 `/execute` 请求返回 401 |
| `SANDBOX_MAX_CONCURRENCY` | `2` | 并发子进程上限，超出返回 429 |
| `SANDBOX_MAX_TIMEOUT_MS` | `10000` | 单次执行超时上限 |
| `SANDBOX_MAX_BODY_BYTES` | `524288` | 请求体上限 |

## 验证

```bash
pnpm vitest run src/lib/sandbox   # 进程级（无需 Docker）
bash services/code-sandbox/security-test.sh   # 容器级（需要 Docker）
```
