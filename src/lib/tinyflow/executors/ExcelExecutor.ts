import * as XLSX from 'xlsx';
import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { uploadBufferToOSS } from '@/lib/oss-server';

// ===== Excel 节点执行器 =====
// 将数据生成 .xlsx 文件（SheetJS 写入方向，不解析外部文件——避免 XLSX 解析类安全问题）
// 数据来源（按优先级）：
//   1. node.data.parameters 中名为 data/rows/list/items/result/output 的输入（上游节点输出）
//   2. node.data.jsonData（静态 JSON 数组）
// 输出：
//   - base64（默认）：{ base64, fileName, sheetName, rowCount }——前端可直接下载
//   - oss：{ ossKey, url, fileName, sheetName, rowCount }（需已配置存储）

const DATA_FIELD_CANDIDATES = ['data', 'rows', 'list', 'items', 'result', 'output'];
const DEFAULT_FILE_NAME = 'data.xlsx';
const DEFAULT_SHEET_NAME = 'Sheet1';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 提取数据数组（优先输入字段，其次 jsonData） */
function extractRows(
  inputs: Record<string, unknown>,
  jsonData: unknown,
): unknown[] {
  if (inputs) {
    for (const key of DATA_FIELD_CANDIDATES) {
      const v = inputs[key];
      if (Array.isArray(v)) return v;
      // 上游输出可能是 { root: [...] } 或 { output: [...] } 包装——尝试再取一层
      if (isRecord(v)) {
        for (const inner of DATA_FIELD_CANDIDATES) {
          if (Array.isArray((v as Record<string, unknown>)[inner])) {
            return (v as Record<string, unknown>)[inner] as unknown[];
          }
        }
      }
    }
  }
  if (Array.isArray(jsonData)) return jsonData;
  return [];
}

export class ExcelExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    const hasParams = Array.isArray(data.parameters) && data.parameters.length > 0;
    if (!hasParams && !Array.isArray(data.jsonData)) {
      return 'Excel 节点缺少数据（请连接上游数据或将 jsonData 配置为数组）';
    }
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data as Record<string, unknown>;
    const params = (Array.isArray(data.parameters) ? data.parameters : []) as never[];
    const inputs = this.paramResolver.resolveList(params, context) || {};

    const rows = extractRows(inputs, data.jsonData);
    if (rows.length === 0) {
      throw new Error('Excel 节点没有可写入的数据（数据为空数组或未匹配到输入字段）');
    }

    const sheetName = String(data.sheetName || DEFAULT_SHEET_NAME).slice(0, 31);
    const fileName = String(data.fileName || DEFAULT_FILE_NAME);
    const outputType = data.outputType === 'oss' ? 'oss' : 'base64';

    // 生成工作簿（SheetJS 纯写入，不解析任何外部文件）
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
    }) as Buffer;

    if (outputType === 'oss') {
      const key = `workflow/excel/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`;
      const ossKey = await uploadBufferToOSS(
        key,
        Buffer.from(buffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      if (!ossKey) {
        throw new Error(
          'OSS 未配置或上传失败——请先在管理后台「存储设置」配置 OSS，或将节点输出方式改为 base64',
        );
      }
      return {
        ossKey,
        fileName,
        sheetName,
        rowCount: rows.length,
      };
    }

    return {
      base64: Buffer.from(buffer).toString('base64'),
      fileName,
      sheetName,
      rowCount: rows.length,
    };
  }
}
