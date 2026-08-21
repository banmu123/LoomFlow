import { redirect } from 'next/navigation';

// 平台即人生：对话是核心入口，成长在对话中自然发生
// 不再有独立的成长页面——AI 教练在每次对话中理解用户、引导方向
export default function RootPage() {
  redirect('/chat');
}
