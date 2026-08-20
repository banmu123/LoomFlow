'use client';

import { useCallback, useRef, useState } from 'react';
import { Play, Loader2, Terminal, FlaskConical, Lightbulb, BookOpen, SearchCheck, Bug } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MonacoEditor } from '@/components/CodeLab/MonacoEditor';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { SimpleChatMessage } from '@/components/SimpleChatMessage';

// ===== Code Lab MVP：Monaco + 沙箱执行 + 测试 + AI Mentor =====

const DEFAULT_CODE = `// 在这里写你的 JavaScript / TypeScript 代码
// 例如：定义一个函数，然后在 Tests 里验证
function add(a, b) {
  return a + b;
}

console.log('add(1,2) =', add(1, 2));`;

const DEFAULT_TESTS = `// 测试用例（可访问上方代码的顶层声明）
// 可用：assert(cond, msg) / assertEq(actual, expected, msg)
assertEq(add(1, 2), 3, '1+2=3');
assertEq(add(-1, 1), 0, '-1+1=0');
console.log('✓ 全部测试通过');`;

export default function CodeLabPage() {
  const t = useT();
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [tests, setTests] = useState(DEFAULT_TESTS);
  const [tab, setTab] = useState<'code' | 'tests'>('code');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<Array<{ type: 'log' | 'result' | 'error'; text: string }>>([]);

  const codeRef = useRef(code);
  codeRef.current = code;
  const testsRef = useRef(tests);
  testsRef.current = tests;
  const outputRef = useRef(output);
  outputRef.current = output;

  // AI Mentor（后端按 action 走 Hint/Explain/Review/Debug 规则）
  const [mentorAction, setMentorAction] = useState('hint');
  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/code-lab/mentor',
      prepareSendMessagesRequest: (options) => ({
        ...options,
        body: {
          ...options.body,
          action: mentorAction,
          code: codeRef.current,
          tests: testsRef.current,
          output: outputRef.current.map((o) => `${o.type}: ${o.text}`).join('\n'),
          error: outputRef.current.find((o) => o.type === 'error')?.text ?? '',
        },
      }),
    }),
  });

  const run = async () => {
    setRunning(true);
    setOutput([]);
    try {
      const res = await fetch('/api/code-lab/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tests }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutput([{ type: 'error', text: data?.error || t('lab.runFailed') }]);
        return;
      }
      const lines: Array<{ type: 'log' | 'result' | 'error'; text: string }> = (data.output ?? []).map(
        (line: string) => ({ type: 'log', text: line }),
      );
      if (!data.ok) {
        lines.push({ type: 'error', text: data.error || t('lab.executionError') });
      } else if (data.result !== undefined && data.result !== null) {
        lines.push({ type: 'result', text: `→ ${JSON.stringify(data.result)}` });
      }
      if (lines.length === 0) lines.push({ type: 'log', text: t('lab.noOutput') });
      setOutput(lines);
    } catch {
      setOutput([{ type: 'error', text: t('lab.networkError') }]);
    } finally {
      setRunning(false);
    }
  };

  const askMentor = (action: string) => {
    setMentorAction(action);
    sendMessage({ text: action });
  };

  const busy = status === 'streaming' || status === 'submitted';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{t('lab.title')}</span>
          <Badge variant="outline" className="ml-1 text-[10px]">
            {t('lab.sandbox')}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={language} onValueChange={setLanguage}>
            <TabsList className="h-7">
              <TabsTrigger value="javascript" className="text-xs px-2.5">
                JS
              </TabsTrigger>
              <TabsTrigger value="typescript" className="text-xs px-2.5">
                TS
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" onClick={run} disabled={running || !code.trim()}>
            {running ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1 h-3.5 w-3.5" />
            )}
            {t('lab.run')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：Code / Tests */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'code' | 'tests')}>
              <TabsList className="h-7">
                <TabsTrigger value="code" className="text-xs px-3">
                  {t('lab.code')}
                </TabsTrigger>
                <TabsTrigger value="tests" className="text-xs px-3">
                  {t('lab.tests')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'code' ? (
              <MonacoEditor language={language} value={code} onChange={setCode} />
            ) : (
              <MonacoEditor language={language} value={tests} onChange={setTests} />
            )}
          </div>

          {/* 输出区 */}
          <div className="h-40 shrink-0 border-t border-border">
            <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1">
              <Terminal className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] font-medium text-muted-foreground">
                {t('lab.output')}
              </span>
            </div>
            <div className="h-[calc(100%-26px)] overflow-y-auto p-2 font-mono text-xs">
              {output.length === 0 && (
                <p className="text-muted-foreground/60">{t('lab.outputEmpty')}</p>
              )}
              {output.map((line, idx) => (
                <pre
                  key={idx}
                  className={
                    line.type === 'error'
                      ? 'whitespace-pre-wrap text-red-500'
                      : line.type === 'result'
                        ? 'whitespace-pre-wrap text-green-600'
                        : 'whitespace-pre-wrap text-foreground/80'
                  }
                >
                  {line.text}
                </pre>
              ))}
            </div>
          </div>
        </div>

        {/* 右：AI Mentor */}
        <div className="flex h-full w-[340px] shrink-0 flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{t('lab.mentor')}</span>
            {busy && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />}
          </div>

          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
            {(
              [
                ['hint', Lightbulb],
                ['explain', BookOpen],
                ['review', SearchCheck],
                ['debug', Bug],
              ] as const
            ).map(([action, Icon]) => (
              <Button
                key={action}
                size="sm"
                variant={mentorAction === action && messages.length > 0 ? 'default' : 'outline'}
                className="h-6 flex-1 text-[11px]"
                onClick={() => askMentor(action)}
                disabled={busy}
              >
                <Icon className="mr-1 h-3 w-3" />
                {t(`lab.mentor${action.charAt(0).toUpperCase()}${action.slice(1)}`)}
              </Button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {t('lab.mentorHint')}
              </p>
            )}
            {messages.map((msg) => {
              const text = Array.isArray(msg.parts)
                ? msg.parts
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { text?: string }).text ?? '')
                    .join('')
                : String((msg as { content?: unknown }).content ?? '');
              if (!text) return null;
              const isLast = messages[messages.length - 1]?.id === msg.id;
              return (
                <SimpleChatMessage
                  key={msg.id}
                  role={msg.role as 'user' | 'assistant'}
                  content={text}
                  status={msg.role === 'assistant' && isLast && busy ? 'streaming' : 'done'}
                />
              );
            })}
          </div>

          <div className="border-t border-border p-2">
            {busy && (
              <Button variant="destructive" size="sm" className="w-full h-7 text-xs" onClick={stop}>
                {t('workflows.stopRun')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
