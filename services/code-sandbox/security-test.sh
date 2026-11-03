#!/usr/bin/env bash
# =====================================================
# 容器级安全验证（需要 Docker，CI 或本地手动执行）
#
# 与单元测试的区别：
#   - vitest 里的 sandbox 测试只验证「进程内」行为（harness 子进程）
#   - 本脚本验证真实的容器边界：非 root、只读文件系统、网络隔离、资源限制
#
# 用法：bash services/code-sandbox/security-test.sh
# =====================================================
set -Eeuo pipefail

IMAGE="loomflow-sandbox:security-test"
TOKEN="$(openssl rand -hex 16)"
PORT="${SANDBOX_TEST_PORT:-18090}"
BASE="http://127.0.0.1:${PORT}"

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; exit 1; }

command -v docker >/dev/null || { echo "docker 不可用，跳过容器安全测试"; exit 0; }

cleanup() { docker rm -f loomflow-sandbox-test >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "== build =="
docker build -t "$IMAGE" "$(dirname "$0")"

echo "== run hardened container =="
docker run -d --name loomflow-sandbox-test \
  --read-only \
  --tmpfs /tmp:size=64m,noexec,nosuid \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 128 \
  --memory 512m \
  --cpus 1 \
  -e SANDBOX_RUNNER_TOKEN="$TOKEN" \
  -p "127.0.0.1:${PORT}:8090" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  curl -fsS --noproxy '*' "${BASE}/health" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "== assertions =="

[ "$(docker exec loomflow-sandbox-test id -u)" != "0" ] \
  && pass "进程不以 root 运行" || fail "容器内是 root"

curl -fsS --noproxy '*' "${BASE}/health" | grep -q '"status":"ok"' \
  && pass "健康检查可用" || fail "健康检查失败"

code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST "${BASE}/execute" \
  -H 'content-type: application/json' -d '{"code":"return 1"}')
[ "$code" = "401" ] && pass "无密钥请求被拒绝（401）" || fail "无密钥请求返回 ${code}"

body=$(curl -s --noproxy '*' -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -H "x-loomflow-sandbox-token: ${TOKEN}" \
  -d '{"code":"return require(\"fs\").readdirSync(\"/\");","inputs":{},"timeoutMs":2000}')
echo "$body" | grep -q '"ok":false' && pass "宿主文件系统访问被拒绝" || fail "fs 访问未被拦截: $body"

body=$(curl -s --noproxy '*' -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -H "x-loomflow-sandbox-token: ${TOKEN}" \
  -d '{"code":"const p = this.constructor.constructor(\"return process\")(); return p.env;","inputs":{},"timeoutMs":2000}')
echo "$body" | grep -q '"ok":false' && pass "vm 逃逸尝试被拒绝" || fail "逃逸成功: $body"

code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST "${BASE}/execute" \
  -H 'content-type: application/json' \
  -H "x-loomflow-sandbox-token: ${TOKEN}" \
  -d '{"code":"while(true){}","inputs":{},"timeoutMs":1000}')
[ "$code" = "504" ] && pass "超时被强制终止（504）" || fail "超时返回 ${code}"

echo "  -- 网络隔离（同一镜像，--network none）--"
docker run --rm --network none "$IMAGE" \
  node -e "fetch('https://example.com',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(1)).catch(()=>process.exit(0))" \
  && pass "无外网出口时请求失败（预期）" || fail "容器仍可访问外网"

echo
echo "全部通过。注意：这只证明「该配置下」的边界，不等于对所有攻击面免疫。"
