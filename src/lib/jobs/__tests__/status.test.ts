import { describe, it, expect } from 'vitest';
import { classifyJobError, JobError } from '../errors';
import { isTerminalJobStatus, jobStatusToApiStatus, type JobStatus } from '../types';

describe('任务状态映射', () => {
  it.each<[JobStatus, string]>([
    ['queued', 'queued'],
    ['retrying', 'queued'],
    ['running', 'running'],
    ['cancel_requested', 'running'],
    ['succeeded', 'completed'],
    ['failed', 'failed'],
    ['dead_letter', 'failed'],
    ['cancelled', 'cancelled'],
  ])('%s → %s', (jobStatus, apiStatus) => {
    expect(jobStatusToApiStatus(jobStatus)).toBe(apiStatus);
  });

  it('终态判定', () => {
    expect(isTerminalJobStatus('succeeded')).toBe(true);
    expect(isTerminalJobStatus('dead_letter')).toBe(true);
    expect(isTerminalJobStatus('running')).toBe(false);
    expect(isTerminalJobStatus('cancel_requested')).toBe(false);
  });
});

describe('任务错误分类', () => {
  it('沙箱不可用可重试', () => {
    const e = Object.assign(new Error('沙箱不可用'), { code: 'sandbox_unavailable' });
    expect(classifyJobError(e)).toMatchObject({
      errorClass: 'sandbox_unavailable',
      retryable: true,
    });
  });

  it('超时可重试', () => {
    const e = Object.assign(new Error('timeout'), { name: 'RunTimeoutError' });
    expect(classifyJobError(e).errorClass).toBe('timeout');
    expect(classifyJobError(e).retryable).toBe(true);
  });

  it('取消不可重试', () => {
    const e = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    expect(classifyJobError(e)).toMatchObject({ errorClass: 'cancelled', retryable: false });
  });

  it('工作流被修改不可重试', () => {
    const e = new JobError('workflow_changed', 'workflow changed');
    expect(classifyJobError(e)).toMatchObject({
      errorClass: 'workflow_changed',
      retryable: false,
    });
  });

  it('未知异常默认可重试（避免一次性丢任务）', () => {
    expect(classifyJobError(new Error('boom'))).toMatchObject({
      errorClass: 'execution_error',
      retryable: true,
    });
  });

  it('JobError 可显式覆盖是否重试', () => {
    const e = new JobError('execution_error', 'nope', false);
    expect(classifyJobError(e).retryable).toBe(false);
  });
});
