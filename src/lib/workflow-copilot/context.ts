/**
 * Copilot Context Builder（Part 7）
 *
 * AI 不应只拿当前 Canvas JSON，应根据任务加载上下文：
 *   workout / version / nodes / recentRuns / trace / tests / notes / metadata
 *
 * 实现上下文裁剪：按需加载 + 每个来源设 token 预算上限，避免把全部历史塞给 LLM。
 */

import type { TinyflowData } from '../tinyflow/types';

export type CopilotTask =
  | 'create'
  | 'modify'
  | 'debug'
  | 'explain'
  | 'optimize'
  | 'test'
  | 'analyze_failure';

export interface ContextSources {
  workflow?: TinyflowData;
  version?: number;
  nodeDefinitions?: unknown[];
  recentRuns?: unknown[];
  trace?: unknown;
  tests?: unknown[];
  notes?: string;
  errorLogs?: unknown[];
}

export interface CopilotContext {
  task: CopilotTask;
  workflowId?: string;
  sources: ContextSources;
  /** 各来源的 token 预算分配（裁剪后 size） */
  budgets: Record<string, number>;
  /** 加载了哪些来源（flexible trim） */
  loaded: string[];
}

const BUDGETS: Record<CopilotTask, { workflow: number; runs: number; trace: number; tests: number; notes: number }> = {
  create: { workflow: 0, runs: 0, trace: 0, tests: 0, notes: 0 },
  modify: { workflow: 4000, runs: 0, trace: 0, tests: 800, notes: 800 },
  debug: { workflow: 4000, runs: 2000, trace: 2000, tests: 0, notes: 800 },
  explain: { workflow: 5000, runs: 0, trace: 0, tests: 0, notes: 0 },
  optimize: { workflow: 4000, runs: 1500, trace: 1500, tests: 0, notes: 800 },
  test: { workflow: 3000, runs: 0, trace: 0, tests: 2500, notes: 0 },
  analyze_failure: { workflow: 4000, runs: 2500, trace: 2500, tests: 0, notes: 800 },
};

/** 按字符预算裁剪字符串（约压缩 4 char/token 粗估） */
function trimText(raw: string, chars: number): string {
  if (chars <= 0 || !raw) return '';
  return raw.length > chars ? `${raw.slice(0, chars)}…（已裁剪）` : raw;
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function trimJson(raw: unknown, chars: number): unknown {
  const s = stringify(raw);
  if (!s) return '';
  if (s.length <= chars) return raw;
  return `${s.slice(0, chars)}…（已裁剪）`;
}

function summarizeRuns(runs: unknown[]): unknown[] {
  return runs.slice(0, 6).map((r) => {
    const o = (r || {}) as Record<string, unknown>;
    return {
      status: o.status,
      error: typeof o.error === 'string' ? o.error.slice(0, 200) : o.error,
      createdAt: o.created_at ?? o.createdAt,
      durationMs: o.duration_ms ?? o.durationMs,
    };
  });
}

function summarizeTrace(trace: unknown): unknown {
  return trimJson(trace, 2500);
}

/**
 * 构建上下文（自动按 task 裁剪）。
 * @param task 任务类型
 * @param workflowId 工作流 id（可选）
 * @param sources 可用来源（会按预算裁剪）
 */
export function buildCopilotContext(
  task: CopilotTask,
  workflowId: string | undefined,
  sources: ContextSources,
): CopilotContext {
  const budget = BUDGETS[task];
  const loaded: string[] = [];

  const ctx: CopilotContext = { task, workflowId, sources: {}, budgets: budget, loaded };

  // 工作流本体
  if (sources.workflow && budget.workflow > 0) {
    ctx.sources.workflow = trimJson(sources.workflow, budget.workflow) as TinyflowData;
    loaded.push('workflow');
  }
  if (sources.version !== undefined) ctx.sources.version = sources.version;

  if (sources.nodeDefinitions && sources.nodeDefinitions.length > 0) {
    ctx.sources.nodeDefinitions = sources.nodeDefinitions.slice(0, 20);
  }

  // 最近运行
  if (sources.recentRuns && budget.runs > 0) {
    ctx.sources.recentRuns = summarizeRuns(sources.recentRuns);
    loaded.push('recentRuns');
  }

  // trace
  if (sources.trace && budget.trace > 0) {
    ctx.sources.trace = summarizeTrace(sources.trace);
    loaded.push('trace');
  }

  // tests
  if (sources.tests && budget.tests > 0) {
    ctx.sources.tests = sources.tests.slice(0, 8).map((t) => trimJson(t, budget.tests));
    loaded.push('tests');
  }

  // notes
  if (sources.notes && budget.notes > 0) {
    ctx.sources.notes = trimText(sources.notes, budget.notes);
    loaded.push('notes');
  }

  if (sources.errorLogs && budget.runs > 0) {
    ctx.sources.errorLogs = sources.errorLogs.slice(0, 5);
    loaded.push('errorLogs');
  }

  return ctx;
}

/** 把上下文渲染成注入给 AI 的文本块 */
export function contextToPrompt(ctx: CopilotContext): string {
  const sections: string[] = [];
  if (ctx.workflowId) sections.push(`工作流 ID: ${ctx.workflowId}`);
  if (ctx.sources.version !== undefined) sections.push(`版本: v${ctx.sources.version}`);

  if (ctx.sources.workflow) {
    sections.push(`## 当前工作流\n\n\`\`\`json\n${stringify(ctx.sources.workflow)}\n\`\`\``);
  }
  if (ctx.sources.recentRuns?.length) {
    sections.push(`## 最近运行\n\n${stringify(ctx.sources.recentRuns)}`);
  }
  if (ctx.sources.trace) {
    sections.push(`## 执行 Trace\n\n${stringify(ctx.sources.trace)}`);
  }
  if (ctx.sources.tests?.length) {
    sections.push(`## 已有测试用例\n\n${stringify(ctx.sources.tests)}`);
  }
  if (ctx.sources.notes) {
    sections.push(`## 工作流笔记\n\n${ctx.sources.notes}`);
  }
  if (ctx.sources.errorLogs?.length) {
    sections.push(`## 错误日志\n\n${stringify(ctx.sources.errorLogs)}`);
  }
  return sections.join('\n\n');
}
