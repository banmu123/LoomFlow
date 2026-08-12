import type { ModelDefinition } from '../capabilities';

// ===== 内置模型注册表 =====
// 新增模型只需在这里加一条（无需改引擎/执行器）

export const BUILTIN_MODELS: ModelDefinition[] = [
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    capabilities: ['text'],
    label: 'DeepSeek Flash',
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    capabilities: ['text'],
    label: 'DeepSeek Pro',
  },
  // 视觉模型（预留：配置 ARK_API_KEY 后可用）
  // 接入方式：在火山方舟开通对应模型，确认模型 ID 后取消注释
  // {
  //   id: 'qwen-vl-max',
  //   provider: 'ark',
  //   capabilities: ['text', 'vision'],
  //   label: 'Qwen VL（视觉）',
  // },
];
