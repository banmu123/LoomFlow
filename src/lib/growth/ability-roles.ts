import type { AbilityScores, AbilityDimension } from './ability-types';
import { DIMENSIONS } from './ability-types';
import { calculateStdDev, getTopDimensions } from './ability-scoring';

// ===== 角色定位系统 =====
// 根据六维分数确定用户角色，帮助用户理解自己的定位

export interface RoleDefinition {
  id: string;
  labelKey: string;
  icon: string;
  descriptionKey: string;
  topDimensions: [AbilityDimension, AbilityDimension];
}

export const ROLES: RoleDefinition[] = [
  {
    id: 'thinker',
    labelKey: 'life.roleThinker',
    icon: '🧠',
    descriptionKey: 'life.roleThinkerDesc',
    topDimensions: ['thinking', 'learning'],
  },
  {
    id: 'creator',
    labelKey: 'life.roleCreator',
    icon: '🎨',
    descriptionKey: 'life.roleCreatorDesc',
    topDimensions: ['creativity', 'thinking'],
  },
  {
    id: 'executor',
    labelKey: 'life.roleExecutor',
    icon: '⚡',
    descriptionKey: 'life.roleExecutorDesc',
    topDimensions: ['execution', 'resilience'],
  },
  {
    id: 'connector',
    labelKey: 'life.roleConnector',
    icon: '🤝',
    descriptionKey: 'life.roleConnectorDesc',
    topDimensions: ['communication', 'creativity'],
  },
  {
    id: 'learner',
    labelKey: 'life.roleLearner',
    icon: '📚',
    descriptionKey: 'life.roleLearnerDesc',
    topDimensions: ['learning', 'thinking'],
  },
  {
    id: 'resilient',
    labelKey: 'life.roleResilient',
    icon: '💪',
    descriptionKey: 'life.roleResilientDesc',
    topDimensions: ['resilience', 'execution'],
  },
];

export const ALLROUNDER_ROLE: RoleDefinition = {
  id: 'allrounder',
  labelKey: 'life.roleAllrounder',
  icon: '🌟',
  descriptionKey: 'life.roleAllrounderDesc',
  topDimensions: ['thinking', 'creativity'],
};

const STDDEV_THRESHOLD = 12;

export interface DeterminedRole {
  id: string;
  labelKey: string;
  icon: string;
  descriptionKey: string;
  strengths: AbilityDimension[];
  growthAreas: AbilityDimension[];
}

/** 根据六维分数确定角色 */
export function determineRole(scores: AbilityScores): DeterminedRole {
  const stddev = calculateStdDev(scores);

  if (stddev < STDDEV_THRESHOLD) {
    return {
      id: ALLROUNDER_ROLE.id,
      labelKey: ALLROUNDER_ROLE.labelKey,
      icon: ALLROUNDER_ROLE.icon,
      descriptionKey: ALLROUNDER_ROLE.descriptionKey,
      strengths: getTopDimensions(scores, 2),
      growthAreas: getBottomDimensions(scores, 2),
    };
  }

  const top2 = getTopDimensions(scores, 2);

  for (const role of ROLES) {
    if (
      top2.includes(role.topDimensions[0]) &&
      top2.includes(role.topDimensions[1])
    ) {
      return {
        id: role.id,
        labelKey: role.labelKey,
        icon: role.icon,
        descriptionKey: role.descriptionKey,
        strengths: top2,
        growthAreas: getBottomDimensions(scores, 2),
      };
    }
  }

  return {
    id: ROLES[0].id,
    labelKey: ROLES[0].labelKey,
    icon: ROLES[0].icon,
    descriptionKey: ROLES[0].descriptionKey,
    strengths: top2,
    growthAreas: getBottomDimensions(scores, 2),
  };
}

function getBottomDimensions(scores: AbilityScores, n: number): AbilityDimension[] {
  return [...DIMENSIONS].sort((a, b) => scores[a] - scores[b]).slice(0, n);
}
