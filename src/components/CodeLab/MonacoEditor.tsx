'use client';

import dynamic from 'next/dynamic';

// Monaco 编辑器：仅在客户端加载（ssr: false 避免 monaco 在服务端求值报 window 错误），
// 本地 monaco 自托管可用
const CodeEditor = dynamic(() => import('./CodeEditor'), { ssr: false });

export function MonacoEditor({
  language,
  value,
  onChange,
  height = '100%',
}: {
  language: string;
  value: string;
  onChange?: (value: string) => void;
  height?: string;
}) {
  return (
    <CodeEditor language={language} value={value} onChange={onChange} height={height} />
  );
}
