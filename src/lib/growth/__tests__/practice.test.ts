import { describe, it, expect } from 'vitest';
import {
  isValidPracticeType,
  isValidPracticeDifficulty,
  isValidPracticeStatus,
  validatePracticeInput,
  PRACTICE_TYPES,
  PRACTICE_DIFFICULTIES,
  PRACTICE_STATUSES,
} from '../types';

describe('Practice 类型校验', () => {
  it('类型枚举完整', () => {
    expect(PRACTICE_TYPES).toEqual(['code', 'workflow', 'project', 'reflection']);
    expect(PRACTICE_DIFFICULTIES).toEqual(['beginner', 'intermediate', 'advanced']);
    expect(PRACTICE_STATUSES).toEqual(['pending', 'in_progress', 'completed']);
  });

  it('类型校验', () => {
    expect(isValidPracticeType('code')).toBe(true);
    expect(isValidPracticeType('workflow')).toBe(true);
    expect(isValidPracticeType('project')).toBe(true);
    expect(isValidPracticeType('reflection')).toBe(true);
    expect(isValidPracticeType('hack')).toBe(false);
  });

  it('难度校验', () => {
    expect(isValidPracticeDifficulty('beginner')).toBe(true);
    expect(isValidPracticeDifficulty('intermediate')).toBe(true);
    expect(isValidPracticeDifficulty('advanced')).toBe(true);
    expect(isValidPracticeDifficulty('easy')).toBe(false);
  });

  it('状态校验', () => {
    expect(isValidPracticeStatus('pending')).toBe(true);
    expect(isValidPracticeStatus('in_progress')).toBe(true);
    expect(isValidPracticeStatus('completed')).toBe(true);
    expect(isValidPracticeStatus('done')).toBe(false);
  });
});

describe('Practice 输入校验', () => {
  const validInput = {
    title: '用循环节点处理数组',
    capability_id: 'cap-123',
  };

  it('正常输入通过', () => {
    const v = validatePracticeInput(validInput);
    expect(v.error).toBeUndefined();
    expect(v.title).toBe('用循环节点处理数组');
    expect(v.capability_id).toBe('cap-123');
    expect(v.type).toBe('code');
    expect(v.difficulty).toBe('beginner');
    expect(v.instructions).toBe('');
  });

  it('缺少 capability_id 报错', () => {
    const v = validatePracticeInput({ title: 'test' });
    expect(v.error).toBeTruthy();
    expect(v.error).toContain('capability_id');
  });

  it('空标题报错', () => {
    const v = validatePracticeInput({ title: '', capability_id: 'cap-1' });
    expect(v.error).toBeTruthy();
    expect(v.error).toContain('标题');
  });

  it('超长标题报错', () => {
    const v = validatePracticeInput({ title: 'a'.repeat(300), capability_id: 'cap-1' });
    expect(v.error).toBeTruthy();
    expect(v.error).toContain('过长');
  });

  it('自定义类型和难度', () => {
    const v = validatePracticeInput({
      ...validInput,
      type: 'workflow',
      difficulty: 'advanced',
    });
    expect(v.type).toBe('workflow');
    expect(v.difficulty).toBe('advanced');
  });

  it('无效类型回退默认值', () => {
    const v = validatePracticeInput({ ...validInput, type: 'invalid' });
    expect(v.type).toBe('code');
  });

  it('无效难度回退默认值', () => {
    const v = validatePracticeInput({ ...validInput, difficulty: 'hard' });
    expect(v.difficulty).toBe('beginner');
  });

  it('description 和 instructions 可选', () => {
    const v = validatePracticeInput({
      ...validInput,
      description: ' 描述内容 ',
      instructions: ' 操作步骤 ',
    });
    expect(v.description).toBe('描述内容');
    expect(v.instructions).toBe('操作步骤');
  });

  it('空 description 返回 null', () => {
    const v = validatePracticeInput({ ...validInput, description: '   ' });
    expect(v.description).toBeNull();
  });
});
