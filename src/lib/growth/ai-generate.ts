import type { Goal } from './types';
import type { EvidenceSource, EvidenceRule } from './evidence';

// ===== Growth AI 生成：提示词组装 + JSON 解析（纯函数，可单测）=====

export interface GeneratedGoal {
  title: string;
  description: string;
}

export interface GeneratedCapability {
  title: string;
  description: string;
  prerequisites: string[];
  /** 证据规则（按标题关键词推断，Growth Engine 据此用真实行为推进状态） */
  evidence_rule?: EvidenceRule;
}

export interface GeneratedJourney {
  title: string;
  description: string;
  capabilities: GeneratedCapability[];
}

export function buildGoalPrompt(userInput: string): string {
  return `用户想定义一个个人成长目标。请把下面这段自然语言提炼为一个清晰、可执行的目标。

用户输入：
"""${userInput}"""

输出 JSON（不要输出其他内容）：
{
  "title": "目标标题（简短，如：成为 AI 应用开发者）",
  "description": "目标描述（2-4 句，说明最终能力与成果）"
}`;
}

export function buildJourneyPrompt(goal: Goal): string {
  return `根据成长目标生成一条学习路径（Journey），包含按顺序的阶段（Capability）。

目标：
${goal.title}
${goal.description ? `描述：${goal.description}` : ''}

要求：
1. 阶段从基础到进阶，4-8 个；每个阶段是一个可学习的能力
2. 每个阶段给出 prerequisites（前置能力标题列表，无则空数组）
3. 不要虚构用户已有能力，阶段以"学习"为导向

输出 JSON（不要输出其他内容）：
{
  "title": "路径标题（如：Java AI 应用开发路线）",
  "description": "路径描述（1-2 句）",
  "capabilities": [
    { "title": "阶段名", "description": "这个阶段学什么、达到什么", "prerequisites": ["前置能力标题"] }
  ]
}`;
}

/** 容错解析 AI 返回的 JSON（支持 ```json 包裹 / 前后杂文本） */
export function parseGeneratedJson<T>(text: string): T | null {
  if (!text) return null;
  let jsonText = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    jsonText = fenced[1];
  } else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = text.slice(start, end + 1);
    }
  }
  try {
    return JSON.parse(jsonText.trim()) as T;
  } catch {
    return null;
  }
}

/** 规范化 AI 生成的 Goal */
export function normalizeGeneratedGoal(raw: unknown): GeneratedGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '';
  if (!title) return null;
  const description =
    typeof r.description === 'string' && r.description.trim() ? r.description.trim() : '';
  return { title, description };
}

/** 按能力标题推断证据规则（真实行为来源 + 阈值） */
export function inferEvidenceRule(title: string): EvidenceRule | undefined {
  const t = title.toLowerCase();
  if (/workflow|composition|编排|自动化|流程|automation/.test(t)) {
    return { source: 'workflow_executed_success', threshold: 3 };
  }
  if (/debug|排错|调试|排查/.test(t)) {
    return { source: 'workflow_executed_success', threshold: 3 };
  }
  if (/api|发布|集成|deploy|publish/.test(t)) {
    return { source: 'api_published', threshold: 1 };
  }
  if (/schedule|定时|调度|cron/.test(t)) {
    return { source: 'schedule_created', threshold: 1 };
  }
  if (/rag|知识库|retrieval/.test(t)) {
    return { source: 'notes', threshold: 3 };
  }
  if (/note|笔记|文档|document/.test(t)) {
    return { source: 'notes', threshold: 2 };
  }
  return { source: 'workflow_created', threshold: 2 };
}

/** 规范化 AI 生成的 Journey（含阶段；过滤空阶段并补全 order + 证据规则） */
export function normalizeGeneratedJourney(raw: unknown): GeneratedJourney | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '';
  if (!title) return null;
  const description =
    typeof r.description === 'string' && r.description.trim() ? r.description.trim() : '';
  const capabilities = Array.isArray(r.capabilities)
    ? (r.capabilities as unknown[])
        .map((c) => {
          if (!c || typeof c !== 'object') return null;
          const cc = c as Record<string, unknown>;
          const cTitle = typeof cc.title === 'string' && cc.title.trim() ? cc.title.trim() : '';
          if (!cTitle) return null;
          const base = {
            title: cTitle,
            description:
              typeof cc.description === 'string' && cc.description.trim()
                ? cc.description.trim()
                : '',
            prerequisites: Array.isArray(cc.prerequisites)
              ? cc.prerequisites.map(String).filter((p) => p.trim().length > 0)
              : [],
          };
          const rule = inferEvidenceRule(cTitle);
          return rule ? { ...base, evidence_rule: rule } : base;
        })
        .filter((c): c is GeneratedCapability => c !== null)
    : [];
  if (capabilities.length === 0) return null;
  return { title, description, capabilities };
}
