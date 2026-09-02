// 新建对话的模板推荐——i18n key，页面用 t() 渲染
// 独立模块：避免欢迎页（ChatLanding）为取常量而静态引入整个 ChatPanel 依赖图
export const RECOMMENDATIONS = [
  'home.templates.dailyNews',
  'home.templates.content',
  'home.templates.customer',
  'home.templates.weeklyReport',
  'home.templates.translator',
];
