import vm from 'node:vm';
import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

// 代码节点沙箱限制
const CODE_TIMEOUT_MS = 5000; // 同步执行超时 5s

// 深克隆输入（切断原型链：绝不把宿主对象/原型传入 vm 上下文）
function cloneInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
  } catch {
    // 含不可序列化值（函数等）时回退为浅拷贝的纯值对象
    return Object.fromEntries(
      Object.entries(inputs).filter(([, v]) => typeof v !== 'function'),
    );
  }
}

export class CodeExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.code) return '代码节点缺少 code';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const code = node.data.code || '';
    if (!code.trim()) throw new Error('代码节点缺少代码内容');

    // 解析输入参数
    const params = node.data.parameters || [];
    const inputs = cloneInputs(this.paramResolver.resolveList(params, context) || {});

    const outputDefs = node.data.outputDefs || [];
    const outputNames = outputDefs.map((o) => o.name || o.id || 'output');

    // ===== 沙箱执行（node:vm 隔离上下文 + 超时限制）=====
    // 安全：node:vm 不是安全边界——绝不注入任何宿主 realm 对象
    // （宿主函数的 constructor 链可逃逸回全局作用域，已实测 RCE）。
    // 1. inputs 为深克隆纯数据（无原型/函数）
    // 2. utils 从新 realm 内获取（context 化后的 JSON/Math 等，与宿主隔离）
    // 3. 不提供 fetch（代码节点无网络能力；需要网络请用 HTTP 节点）
    const sandbox: Record<string, unknown> = { inputs };
    vm.createContext(sandbox);
    sandbox.utils = vm.runInContext(
      '({ JSON, Math, String, Number, Boolean, Array, Object, Date, Promise })',
      sandbox,
    );

    // code 作为函数体包装（兼容 return 语义），传入沙箱内的 inputs/utils
    const wrapped = `(function(inputs, utils){ "use strict";\n${code}\n})(inputs, utils)`;

    let finalResult: unknown;
    try {
      finalResult = vm.runInContext(wrapped, sandbox, { timeout: CODE_TIMEOUT_MS });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new Error(`代码执行超时（${CODE_TIMEOUT_MS / 1000}s 限制）`);
      }
      throw new Error(`代码执行错误: ${err.message || String(e)}`);
    }

    // 支持返回 Promise（异步挂起兜底：限时等待，防 `new Promise(()=>{})` 永久占用）
    if (finalResult instanceof Promise) {
      finalResult = await Promise.race([
        finalResult,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`代码执行超时（${CODE_TIMEOUT_MS / 1000}s 限制）`)),
            CODE_TIMEOUT_MS,
          ),
        ),
      ]);
    }

    // 构造输出
    if (outputNames.length === 0) {
      return { output: finalResult };
    }

    if (outputNames.length === 1) {
      return { [outputNames[0]]: finalResult };
    }

    // 多个输出: 期望返回对象
    if (typeof finalResult === 'object' && finalResult !== null) {
      return finalResult as Record<string, unknown>;
    }

    return { output: finalResult };
  }
}
