// 切页骨架屏：路由切换 / 预取加载时的即时视觉反馈
// 覆盖 (main) 下所有页面的加载间隙，避免"点击 → 白屏 → 内容蹦出"的卡顿感
export default function MainLoading() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6" aria-busy="true">
      {/* 页头：标题 + 操作按钮 */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
      </div>

      {/* 内容区：三列卡片占位 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex animate-pulse flex-col gap-3 rounded-lg border border-border/60 p-4"
            style={{ animationDelay: `${i * 75}ms` }}
          >
            <div className="h-4 w-2/5 rounded-md bg-muted" />
            <div className="h-3 w-full rounded-md bg-muted" />
            <div className="h-3 w-4/5 rounded-md bg-muted" />
            <div className="mt-auto flex gap-2 pt-2">
              <div className="h-7 w-16 rounded-md bg-muted" />
              <div className="h-7 w-16 rounded-md bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
