import type { FlowContext } from '../types';

/**
 * 条件表达式求值器
 *
 * 支持:
 * - "==" 等值比较
 * - "!=" 不等
 * - ">" ">=" "<" "<=" 数值比较
 * - "contains" 包含
 * - "startsWith" / "endsWith"
 * - 变量插值 {{nodeId.field}}
 */

export class ExpressionEvaluator {
  private getVariableValue: (name: string, context: FlowContext) => unknown;

  constructor(getVariableValue?: (name: string, context: FlowContext) => unknown) {
    this.getVariableValue =
      getVariableValue ||
      ((name: string, context: FlowContext) => {
        // 直接 ref: nodeId.field
        if (name.includes('.')) {
          const parts = name.split('.');
          const nodeId = parts[0];
          const field = parts.slice(1).join('.');

          if (nodeId === 'input' || nodeId === 'inputs') {
            return this.getNestedValue(context.inputs, field);
          }
          const output = context.nodeOutputs.get(nodeId);
          if (output) {
            return this.getNestedValue(output, field);
          }
        }
        // 从 inputs 取
        return context.inputs[name];
      });
  }

  evaluate(expression: string, context: FlowContext): boolean {
    if (!expression || !expression.trim()) return true;

    const expr = expression.trim();

    // 运算符匹配
    const operators: Array<{
      op: string;
      fn: (left: unknown, right: unknown) => boolean;
    }> = [
      { op: '==', fn: (l, r) => String(l) === String(r) },
      { op: '!=', fn: (l, r) => String(l) !== String(r) },
      { op: '>=', fn: (l, r) => Number(l) >= Number(r) },
      { op: '<=', fn: (l, r) => Number(l) <= Number(r) },
      {
        op: '>',
        fn: (l, r) => Number(l) > Number(r),
      },
      {
        op: '<',
        fn: (l, r) => Number(l) < Number(r),
      },
      {
        op: 'contains',
        fn: (l, r) => String(l).includes(String(r)),
      },
      {
        op: 'startsWith',
        fn: (l, r) => String(l).startsWith(String(r)),
      },
      {
        op: 'endsWith',
        fn: (l, r) => String(l).endsWith(String(r)),
      },
    ];

    for (const { op, fn } of operators) {
      const idx = this.findOperator(expr, op);
      if (idx >= 0) {
        const leftStr = expr.substring(0, idx).trim();
        const rightStr = expr.substring(idx + op.length).trim();
        const leftVal = this.resolveValue(leftStr, context);
        const rightVal = this.resolveValue(rightStr, context);
        return fn(leftVal, rightVal);
      }
    }

    // 无运算符: 非空字符串 / 非0数字 → true
    const val = this.resolveValue(expr, context);
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val.toLowerCase() !== 'false' && val !== '';
    return val !== null && val !== undefined;
  }

  /** 查找运算符位置，避免 >= 被 > 误匹配 */
  private findOperator(expr: string, op: string): number {
    // 先找双字符运算符
    const twoCharOps = ['==', '!=', '>=', '<='];
    if (twoCharOps.includes(op)) {
      return expr.indexOf(op);
    }
    // 单字符运算符需要确认不是双字符的一部分
    if (op === '>' || op === '<') {
      const idx = expr.indexOf(op);
      if (idx < 0) return -1;
      // 检查前一个字符
      if (idx > 0 && (expr[idx - 1] === '>' || expr[idx - 1] === '<' || expr[idx - 1] === '=' || expr[idx - 1] === '!')) {
        return -1;
      }
      return idx;
    }
    return expr.indexOf(op);
  }

  private resolveValue(token: string, context: FlowContext): unknown {
    const trimmed = token.trim();

    // {{var}} 插值
    const templateMatch = trimmed.match(/^\{\{([^}]+)\}\}$/);
    if (templateMatch) {
      return this.getVariableValue(templateMatch[1].trim(), context);
    }

    // 普通变量名 (含点号)
    if (/^[a-zA-Z_$][\w.$]*$/.test(trimmed)) {
      const val = this.getVariableValue(trimmed, context);
      if (val !== undefined) return val;
    }

    // 字符串字面量
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    // 数字
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    // 布尔
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;

    return trimmed;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    if (!path) return obj;
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
