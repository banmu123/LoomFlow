'use client';

import { useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';
import Editor from '@monaco-editor/react';
import { loader } from '@monaco-editor/react';

// 本地 monaco（自托管无外网 CDN 也可用）
loader.config({ monaco });

export default function CodeEditor({
  language,
  value,
  onChange,
  height,
}: {
  language: string;
  value: string;
  onChange?: (value: string) => void;
  height?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        编辑器加载中…
      </div>
    );
  }

  return (
    <Editor
      height={height}
      language={language === 'typescript' ? 'typescript' : 'javascript'}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      theme="vs"
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}
