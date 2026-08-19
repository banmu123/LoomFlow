'use client';

import { useEffect } from 'react';
import { useLocale } from '@/lib/i18n';

// ===== tinyflow 画布内置文本翻译层 =====
// @tinyflow-ai/ui 库硬编码中文且无 i18n API——此 hook 通过 DOM 文本精确替换实现
// 界面国际化（仅替换「整节点文本完全匹配」的固定文案，绝不替换用户自定义内容）。
// 语言切回中文/组件卸载时自动恢复原文。

/** tinyflow 内置中文 → 英文（节点标题 / 面板标签 / 描述 / 占位符） */
export const TINYFLOW_ZH_EN: Record<string, string> = {
  // 节点标题（左侧节点库 + 画布节点默认标题）
  开始节点: 'Start Node',
  结束节点: 'End Node',
  大模型: 'LLM',
  循环: 'Loop',
  知识库: 'Knowledge',
  搜索引擎: 'Search Engine',
  'Http 请求': 'HTTP Request',
  动态代码: 'Code',
  内容模板: 'Template',
  用户确认: 'Human Confirm',

  // 节点描述
  开始定义输入参数: 'Define workflow inputs',
  用于循环执行任务: 'Loop over a collection',
  使用大模型处理问题: 'Process with LLM',
  通过知识库获取内容: 'Retrieve from knowledge base',
  通过搜索引擎搜索内容: 'Search the web',
  '通过 HTTP 请求获取数据': 'Fetch data via HTTP request',
  动态执行代码: 'Execute JavaScript code',
  通过模板引擎生成内容: 'Render text from a template',

  // 节点库分组
  基础节点: 'Basic',
  业务工具: 'Tools',

  // 配置面板分区
  模型设置: 'Model Settings',
  知识库设置: 'Knowledge Base Settings',
  搜索引擎设置: 'Search Engine Settings',
  边属性设置: 'Edge Properties',
  边条件设置: 'Edge Condition',
  输入参数: 'Input Parameters',
  输出参数: 'Output Parameters',
  搜索数据量: 'Result Count',
  搜索的数据条数: 'Result Count',
  获取数据量: 'Result Count',
  关键字: 'Keyword',
  模板内容: 'Template Content',
  用户提示词: 'User Prompt',
  系统提示词: 'System Prompt',
  消息内容: 'Message',
  执行代码: 'Code',
  执行引擎: 'Engine',
  执行条件: 'Condition',
  退出条件: 'Exit Condition',
  循环体: 'Loop Body',
  循环变量: 'Loop Variable',
  循环执行: 'Loop Execution',
  错误重试: 'Retry',
  最大重试次数: 'Max Retries',
  最大循环次数: 'Max Loops',
  节点名称: 'Node Name',
  输入方式: 'Input Mode',
  数据来源: 'Source',
  数据标题: 'Title',
  数据描述: 'Description',
  数据类型: 'Data Type',
  数据选项: 'Options',
  参数名称: 'Name',
  参数类型: 'Type',
  参数描述: 'Description',
  参数值: 'Value',
  默认值: 'Default',
  占位符: 'Placeholder',
  必填: 'Required',
  是否必填: 'Required',
  单选: 'Radio',
  多选: 'Checkbox',
  单行输入框: 'Input',
  多行输入框: 'Textarea',
  固定值: 'Fixed',
  引用: 'Reference',
  表单输入: 'Form',
  其他: 'Other',
  选择: 'Select',
  参数: 'Parameter',
  地址: 'URL',
  头信息: 'Headers',
  请求: 'Request',
  模型: 'Model',
  文件: 'File',
  文字: 'Text',
  文本: 'Text',
  图片: 'Image',
  视频: 'Video',
  音频: 'Audio',
  暂无数据: 'No data',
  无输入参数: 'No input parameters',
  无输出参数: 'No output parameters',
  无确认数据: 'No confirmation data',
  无图片参数: 'No image parameters',
  保存: 'Save',
  删除: 'Delete',
  下拉菜单: 'Dropdown',
  一行一个选项: 'One option per line',

  // 占位符
  请选择搜索引擎: 'Select a search engine',
  请选择知识库: 'Select a knowledge base',
  请选择模型: 'Select a model',
  请选择执行引擎: 'Select an engine',
  请选择请求方式: 'Select a method',
  请输入关键字: 'Enter keyword',
  请输入参数: 'Enter parameter name',
  请输入参数值: 'Enter value',
  请输入参数描述: 'Enter description',
  请输入参数默认值: 'Enter default value',
  请输入数据标题: 'Enter field title',
  请输入数据描述: 'Enter description',
  请输入模板内容: 'Enter template content',
  请输入用户提示词: 'Enter user prompt',
  请输入系统提示词: 'Enter system prompt',
  请输入请求信息: 'Enter request',
  '请输入 json 信息': 'Enter JSON',
  '请输入url': 'Enter URL',
  请输入执行代码: 'Enter code',
  请输入用户需要确认的消息内容: 'Enter the confirmation message',
  请输入边条件: 'Enter edge condition',
};

/**
 * 挂载到画布容器：locale=en 时把 tinyflow 内置中文替换为英文；
 * 切回中文或卸载时恢复原文。
 * 性能：观察 childList + characterData，但替换采用**增量处理**——
 * 只扫描本次变更新增的子树（含自身文本节点），避免画布交互时全量 TreeWalker 扫描。
 */
export function useTinyflowLocale(
  rootRef: React.RefObject<HTMLElement | null>,
): void {
  const { locale } = useLocale();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || locale !== 'en') return;

    // 记录原文（切回中文/卸载时恢复）
    const originals = new Map<Text, string>();

    const translateText = (text: Text) => {
      const raw = text.data;
      if (!originals.has(text)) originals.set(text, raw);
      // trim 匹配（tinyflow 部分文本带前导空格，如 " 开始节点"）
      const trimmed = raw.trim();
      const target = TINYFLOW_ZH_EN[trimmed];
      if (target && raw !== target) {
        const idx = raw.indexOf(trimmed);
        text.data = `${raw.slice(0, idx)}${target}${raw.slice(idx + trimmed.length)}`;
      }
    };

    const walk = (node: Node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let current: Node | null = walker.nextNode();
      while (current) {
        translateText(current as Text);
        current = walker.nextNode();
      }
    };

    // 首次全量替换 + 观察后续变更（增量）
    walk(root);
    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'characterData' && rec.target.nodeType === Node.TEXT_NODE) {
          translateText(rec.target as Text);
          continue;
        }
        for (const node of rec.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            translateText(node as Text);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            walk(node);
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      for (const [text, original] of originals) {
        try {
          text.data = original;
        } catch {
          // 节点已被移除，忽略
        }
      }
    };
  }, [rootRef, locale]);
}
