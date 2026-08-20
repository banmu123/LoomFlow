import { describe, it, expect } from 'vitest';
import {
  isValidGoalStatus,
  isValidJourneyStatus,
  isValidCapabilityStatus,
  validateGoalInput,
  validateJourneyInput,
  defaultCapability,
  CAPABILITY_STATUSES,
} from '../types';
import {
  buildGoalPrompt,
  buildJourneyPrompt,
  parseGeneratedJson,
  normalizeGeneratedGoal,
  normalizeGeneratedJourney,
} from '../ai-generate';

describe('growth 类型校验', () => {
  it('状态校验', () => {
    expect(isValidGoalStatus('active')).toBe(true);
    expect(isValidGoalStatus('paused')).toBe(true);
    expect(isValidGoalStatus('done')).toBe(true);
    expect(isValidGoalStatus('hack')).toBe(false);
    expect(isValidJourneyStatus('active')).toBe(true);
    expect(isValidJourneyStatus('archived')).toBe(true);
    expect(isValidJourneyStatus('x')).toBe(false);
    expect(isValidCapabilityStatus('mastered')).toBe(true);
    expect(isValidCapabilityStatus('locked')).toBe(true);
    expect(isValidCapabilityStatus('nope')).toBe(false);
    expect(CAPABILITY_STATUSES).toHaveLength(4);
  });

  it('Goal 输入校验：空/超长/正常', () => {
    expect(validateGoalInput({ title: '' }).error).toBeTruthy();
    expect(validateGoalInput({ title: '   ' }).error).toBeTruthy();
    expect(validateGoalInput({ title: 'a'.repeat(300) }).error).toBeTruthy();
    const v = validateGoalInput({ title: ' 成为 AI 开发者 ', description: ' 能开发应用 ' });
    expect(v.title).toBe('成为 AI 开发者');
    expect(v.description).toBe('能开发应用');
    expect(validateGoalInput({ title: 'ok', description: '' }).description).toBeNull();
  });

  it('Journey 输入校验', () => {
    expect(validateJourneyInput({ title: '' }).error).toBeTruthy();
    expect(validateJourneyInput({ title: '路径' }).title).toBe('路径');
  });

  it('defaultCapability 默认值', () => {
    const cap = defaultCapability(2);
    expect(cap).toMatchObject({ order: 2, status: 'locked', prerequisites: [], title: '阶段 3' });
    const custom = defaultCapability(0, { title: 'Java', status: 'developing' });
    expect(custom.title).toBe('Java');
    expect(custom.status).toBe('developing');
  });
});

describe('growth AI 提示词与解析', () => {
  it('Goal 提示词包含用户输入', () => {
    const prompt = buildGoalPrompt('我想学 Java');
    expect(prompt).toContain('我想学 Java');
    expect(prompt).toContain('"title"');
  });

  it('Journey 提示词包含目标', () => {
    const prompt = buildJourneyPrompt({
      id: 'g1',
      user_id: 'u1',
      title: 'AI 开发者',
      description: '能开发 AI 应用',
      status: 'active',
      created_at: '',
      updated_at: '',
    });
    expect(prompt).toContain('AI 开发者');
    expect(prompt).toContain('capabilities');
  });

  it('parseGeneratedJson 支持代码块与前后杂文本', () => {
    expect(parseGeneratedJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseGeneratedJson('前文 {"b":2} 后文')).toEqual({ b: 2 });
    expect(parseGeneratedJson('{"c":3}')).toEqual({ c: 3 });
    expect(parseGeneratedJson('not json')).toBeNull();
    expect(parseGeneratedJson('')).toBeNull();
  });

  it('normalizeGeneratedGoal 规范化', () => {
    expect(normalizeGeneratedGoal({ title: ' 目标 ', description: ' 描述 ' })).toEqual({
      title: '目标',
      description: '描述',
    });
    expect(normalizeGeneratedGoal({ title: '' })).toBeNull();
    expect(normalizeGeneratedGoal('x')).toBeNull();
    expect(normalizeGeneratedGoal(null)).toBeNull();
  });

  it('normalizeGeneratedJourney 规范化（过滤空阶段/前置去空）', () => {
    const raw = {
      title: ' 路线 ',
      description: ' 描述 ',
      capabilities: [
        { title: 'Java', description: '基础', prerequisites: [' ', 'Python', ''] },
        { title: ' ' },
        { title: 'REST API', prerequisites: ['Java'] },
      ],
    };
    const j = normalizeGeneratedJourney(raw);
    expect(j).not.toBeNull();
    expect(j!.title).toBe('路线');
    expect(j!.capabilities).toHaveLength(2);
    expect(j!.capabilities[0].prerequisites).toEqual(['Python']);
    expect(j!.capabilities[1].prerequisites).toEqual(['Java']);
  });

  it('normalizeGeneratedJourney 无有效阶段时返回 null', () => {
    expect(normalizeGeneratedJourney({ title: 'x', capabilities: [{ title: '' }] })).toBeNull();
    expect(normalizeGeneratedJourney({ title: '', capabilities: [] })).toBeNull();
  });
});
