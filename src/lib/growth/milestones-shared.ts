// ===== Milestone 共享定义（纯常量/类型，client 组件可安全引用）=====

export const MILESTONE_TYPES = [
  'first_brew',
  'first_recipe',
  'ai_creator',
  'workflow_builder',
  'debugger',
  'automator',
] as const;

export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const MILESTONE_LABEL_KEY: Record<MilestoneType, string> = {
  first_brew: 'growth.milestoneFirstBrew',
  first_recipe: 'growth.milestoneFirstRecipe',
  ai_creator: 'growth.milestoneAiCreator',
  workflow_builder: 'growth.milestoneWorkflowBuilder',
  debugger: 'growth.milestoneDebugger',
  automator: 'growth.milestoneAutomator',
};
