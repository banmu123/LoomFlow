# =====================================================
# LoomFlow Code Sandbox Runner
# 构建：docker build -t loomflow-sandbox services/code-sandbox
# 运行：见 docker-compose.yml（sandbox-runner，仅内部网络）
# =====================================================
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8090

WORKDIR /app

COPY runner.js harness.js ./

# 非 root 运行（node 镜像自带 uid 1000 的 node 用户）
RUN chown -R node:node /app
USER node

EXPOSE 8090

# 镜像内无 curl，使用 Node 标准库探活
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "runner.js"]
