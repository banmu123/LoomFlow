import { describe, it, expect } from 'vitest';
import {
  isValidNoteType,
  NOTE_TYPES,
  notesToPromptText,
} from '../workflow-notes';
import type { WorkflowNote } from '../workflow-notes';

function makeNote(overrides: Partial<WorkflowNote> = {}): WorkflowNote {
  return {
    id: 'n1',
    workflow_id: 'wf1',
    user_id: 'u1',
    version: null,
    type: 'general',
    content: '测试笔记',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

describe('workflow-notes 类型与校验', () => {
  it('内置类型完整（MVP 六类）', () => {
    expect(NOTE_TYPES).toEqual([
      'general',
      'decision',
      'problem',
      'solution',
      'optimization',
      'usage',
    ]);
  });

  it('isValidNoteType 校验', () => {
    expect(isValidNoteType('decision')).toBe(true);
    expect(isValidNoteType('usage')).toBe(true);
    expect(isValidNoteType('hack')).toBe(false);
    expect(isValidNoteType('')).toBe(false);
  });
});

describe('notesToPromptText 提示词文本', () => {
  it('空列表返回提示', () => {
    expect(notesToPromptText([])).toContain('暂无笔记');
  });

  it('含类型标签与可选版本', () => {
    const text = notesToPromptText([
      makeNote({ type: 'decision', content: 'Search 放在 LLM 前', version: 2 }),
      makeNote({ type: 'problem', content: 'Tavily 偶尔超时' }),
    ]);
    expect(text).toContain('[Decision] (v2) Search 放在 LLM 前');
    expect(text).toContain('[Problem] Tavily 偶尔超时');
  });
});
