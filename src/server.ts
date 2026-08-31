import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { initScheduler } from './lib/scheduler';
import { initEvolutionScheduler } from './lib/evolution/scheduler';
import { getRuntimeMode } from './lib/runtime/mode';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);
const runtimeMode = getRuntimeMode();

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // 仅 Docker 模式启动内置 scheduler
  // Serverless 模式由 Vercel Cron 调用 /api/cron/* 端点
  if (runtimeMode === 'docker') {
    // 定时任务调度器：启动时加载所有启用的任务，每 10 分钟同步一次 DB 变更
    // 注意：单进程架构（Docker 单副本）安全；若未来多副本部署，需加分布式锁防重复执行
    initScheduler();

    // 演化调度器：每 30 分钟扫描演化规则，满足条件时自动触发优化分析
    initEvolutionScheduler();
  }

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      // 注入当前路径给服务端 layout（用于登录后 redirect 回原页面）
      if (parsedUrl.pathname) {
        req.headers['x-pathname'] = parsedUrl.pathname;
      }
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      } [runtime: ${runtimeMode}]`,
    );
  });
});
