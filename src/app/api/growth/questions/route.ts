import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getRandomQuestions, getAnswerStats } from '@/lib/growth/question-service';
import { generateQuestions } from '@/lib/growth/ai-questions';
import { isValidDimension } from '@/lib/growth/ability-types';
import { supabase } from '@/lib/supabase/server';
import type { AbilityDimension } from '@/lib/growth/ability-types';
import type { QuestionContent } from '@/lib/growth/question-service';

export const runtime = 'nodejs';

// GET /api/growth/questions - 获取题目
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const dimension = request.nextUrl.searchParams.get('dimension') ?? undefined;
  const difficulty = request.nextUrl.searchParams.get('difficulty') ?? undefined;
  const count = Math.min(Number(request.nextUrl.searchParams.get('count') ?? '10'), 20);

  if (dimension && !isValidDimension(dimension)) {
    return Response.json({ error: '维度不合法' }, { status: 400 });
  }

  let questions = await getRandomQuestions(
    user.id,
    dimension as AbilityDimension | undefined,
    difficulty,
    count,
  );

  if (questions.length < count) {
    const aiQuestions = await generateQuestions(
      (dimension as AbilityDimension) ?? 'thinking',
      difficulty ?? 'beginner',
      count - questions.length,
    );
    const saved = await saveQuestionsToDb(dimension as AbilityDimension ?? 'thinking', difficulty ?? 'beginner', aiQuestions);
    questions = [...questions, ...saved];
  }

  const withoutAnswer = questions.map((q) => ({
    id: q.id,
    dimension: q.dimension,
    difficulty: q.difficulty,
    type: q.type,
    stem: q.content.stem,
    options: q.content.options,
  }));

  return Response.json(withoutAnswer);
}

async function saveQuestionsToDb(
  dimension: AbilityDimension,
  difficulty: string,
  questions: QuestionContent[],
) {
  const saved: Array<{ id: string; dimension: AbilityDimension; difficulty: string; type: string; content: QuestionContent; tags: string[] }> = [];
  for (const q of questions) {
    const { data } = await supabase
      .from('question_bank')
      .insert({
        dimension,
        difficulty,
        type: q.options ? 'choice' : 'scenario',
        content: q,
      })
      .select('id, dimension, difficulty, type, content, tags')
      .single();
    if (data) {
      saved.push({
        id: data.id,
        dimension: data.dimension as AbilityDimension,
        difficulty: data.difficulty,
        type: data.type,
        content: data.content as QuestionContent,
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
      });
    }
  }
  return saved;
}
