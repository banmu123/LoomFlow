// ===== 人生设计 - 六维能力类型定义 =====

export type AbilityDimension =
  | 'thinking'
  | 'creativity'
  | 'execution'
  | 'learning'
  | 'communication'
  | 'resilience';

export const DIMENSIONS: AbilityDimension[] = [
  'thinking',
  'creativity',
  'execution',
  'learning',
  'communication',
  'resilience',
];

export const DIMENSION_META: Record<
  AbilityDimension,
  { labelKey: string; descKey: string; color: string; icon: string }
> = {
  thinking: {
    labelKey: 'life.dimensionThinking',
    descKey: 'life.dimensionThinkingDesc',
    color: '#6366f1',
    icon: '🧠',
  },
  creativity: {
    labelKey: 'life.dimensionCreativity',
    descKey: 'life.dimensionCreativityDesc',
    color: '#f59e0b',
    icon: '🎨',
  },
  execution: {
    labelKey: 'life.dimensionExecution',
    descKey: 'life.dimensionExecutionDesc',
    color: '#10b981',
    icon: '⚡',
  },
  learning: {
    labelKey: 'life.dimensionLearning',
    descKey: 'life.dimensionLearningDesc',
    color: '#3b82f6',
    icon: '📚',
  },
  communication: {
    labelKey: 'life.dimensionCommunication',
    descKey: 'life.dimensionCommunicationDesc',
    color: '#ec4899',
    icon: '🤝',
  },
  resilience: {
    labelKey: 'life.dimensionResilience',
    descKey: 'life.dimensionResilienceDesc',
    color: '#f97316',
    icon: '💪',
  },
};

export interface AbilityScores {
  thinking: number;
  creativity: number;
  execution: number;
  learning: number;
  communication: number;
  resilience: number;
}

export interface AbilityEngagement {
  thinking: number;
  creativity: number;
  execution: number;
  learning: number;
  communication: number;
  resilience: number;
}

export interface UserAbilityProfile {
  scores: AbilityScores;
  engagement: AbilityEngagement;
  role: string;
  roleLabel: string;
  recommendedCareers: string[];
  analyzedAt: string;
}

export interface AbilityScoreHistoryEntry {
  scores: AbilityScores;
  source: string;
  sourceDetail?: string;
  createdAt: string;
}

export function emptyScores(): AbilityScores {
  return { thinking: 0, creativity: 0, execution: 0, learning: 0, communication: 0, resilience: 0 };
}

export function emptyEngagement(): AbilityEngagement {
  return { thinking: 0, creativity: 0, execution: 0, learning: 0, communication: 0, resilience: 0 };
}

export function isValidDimension(s: string): s is AbilityDimension {
  return (DIMENSIONS as readonly string[]).includes(s);
}

export function scoreToLevel(score: number): string {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'developing';
  if (score >= 20) return 'beginner';
  return 'starter';
}

export function scoreToPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
