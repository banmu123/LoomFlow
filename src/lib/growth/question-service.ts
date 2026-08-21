import { supabase } from '@/lib/supabase/server';
import type { AbilityDimension } from './ability-types';
import { DIMENSIONS, isValidDimension } from './ability-types';

// ===== 题库服务 =====

export interface Question {
  id: string;
  dimension: AbilityDimension;
  difficulty: string;
  type: string;
  content: QuestionContent;
  tags: string[];
}

export interface QuestionContent {
  stem: string;
  options?: string[];
  answer: string;
  explanation: string;
}

export interface AnswerRecord {
  id: string;
  user_id: string;
  question_id: string;
  user_answer: string;
  is_correct: boolean;
  score_gained: number;
  dimension: string;
  created_at: string;
}

/** 获取随机题目（排除已答过的） */
export async function getRandomQuestions(
  userId: string,
  dimension?: AbilityDimension,
  difficulty?: string,
  count: number = 10,
): Promise<Question[]> {
  let query = supabase
    .from('question_bank')
    .select('id, dimension, difficulty, type, content, tags')
    .eq('is_active', true);
  if (dimension) query = query.eq('dimension', dimension);
  if (difficulty) query = query.eq('difficulty', difficulty);
  const { data: allQuestions } = await query.limit(100);
  if (!allQuestions || allQuestions.length === 0) return [];

  const { data: answered } = await supabase
    .from('answer_records')
    .select('question_id')
    .eq('user_id', userId);
  const answeredIds = new Set((answered ?? []).map((a: { question_id: string }) => a.question_id));

  const available = allQuestions.filter((q: { id: string }) => !answeredIds.has(q.id));
  const shuffled = available.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(parseQuestion);
}

/** 获取题目详情 */
export async function getQuestion(questionId: string): Promise<Question | null> {
  const { data } = await supabase
    .from('question_bank')
    .select('id, dimension, difficulty, type, content, tags')
    .eq('id', questionId)
    .eq('is_active', true)
    .maybeSingle();
  return data ? parseQuestion(data) : null;
}

/** 提交答案 */
export async function submitAnswer(
  userId: string,
  questionId: string,
  userAnswer: string,
): Promise<{ correct: boolean; scoreGained: number; explanation: string }> {
  const question = await getQuestion(questionId);
  if (!question) throw new Error('题目不存在');

  const correct = userAnswer.toUpperCase() === question.content.answer.toUpperCase();
  const scoreGained = correct ? getDifficultyScore(question.difficulty) : 0;

  await supabase.from('answer_records').insert({
    user_id: userId,
    question_id: questionId,
    user_answer: userAnswer,
    is_correct: correct,
    score_gained: scoreGained,
    dimension: question.dimension,
  });

  return { correct, scoreGained, explanation: question.content.explanation };
}

/** 获取各维度答题统计 */
export async function getAnswerStats(
  userId: string,
): Promise<Record<AbilityDimension, { correct: number; total: number }>> {
  const stats: Record<AbilityDimension, { correct: number; total: number }> = {} as Record<
    AbilityDimension,
    { correct: number; total: number }
  >;
  for (const dim of DIMENSIONS) {
    stats[dim] = { correct: 0, total: 0 };
  }
  const { data } = await supabase
    .from('answer_records')
    .select('dimension, is_correct')
    .eq('user_id', userId);
  for (const r of data ?? []) {
    if (isValidDimension(r.dimension)) {
      const dim = r.dimension as AbilityDimension;
      stats[dim].total++;
      if (r.is_correct) stats[dim].correct++;
    }
  }
  return stats;
}

function parseQuestion(row: {
  id: string;
  dimension: string;
  difficulty: string;
  type: string;
  content: unknown;
  tags: unknown;
}): Question {
  return {
    id: row.id,
    dimension: row.dimension as AbilityDimension,
    difficulty: row.difficulty,
    type: row.type,
    content: row.content as QuestionContent,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  };
}

function getDifficultyScore(difficulty: string): number {
  switch (difficulty) {
    case 'advanced':
      return 10;
    case 'intermediate':
      return 5;
    default:
      return 2;
  }
}
