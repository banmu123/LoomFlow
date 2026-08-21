'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DIMENSION_META, DIMENSIONS } from '@/lib/growth/ability-types';
import type { AbilityDimension } from '@/lib/growth/ability-types';

interface QuestionItem {
  id: string;
  dimension: AbilityDimension;
  difficulty: string;
  type: string;
  stem: string;
  options?: string[];
}

export function QuestionPanel({
  onComplete,
}: {
  onComplete?: () => void;
}) {
  const t = useT();
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; explanation: string; scoreGained?: number } | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [started, setStarted] = useState(false);

  const startQuiz = async (dimension?: AbilityDimension) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ count: '10' });
      if (dimension) params.set('dimension', dimension);
      const res = await fetch(`/api/growth/questions?${params}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setQuestions(data);
        setCurrentIndex(0);
        setSelectedAnswer(null);
        setSubmitted(false);
        setResult(null);
        setTotalScore(0);
        setStarted(true);
      } else {
        toast.error(t('life.noQuestions'));
      }
    } catch {
      toast.error(t('life.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const submitCurrentAnswer = async () => {
    if (!selectedAnswer || submitted) return;
    const q = questions[currentIndex];
    setSubmitted(true);
    try {
      const res = await fetch('/api/growth/questions/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, answer: selectedAnswer }),
      });
      const data = await res.json();
      setResult(data);
      if (data.correct) {
        setTotalScore((s) => s + (data.scoreGained ?? 0));
      }
    } catch {
      toast.error(t('life.submitFailed'));
    }
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setSubmitted(false);
      setResult(null);
    } else {
      setStarted(false);
      onComplete?.();
    }
  };

  if (!started) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('life.selectDimension')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button
            variant="outline"
            className="h-auto flex-col gap-1 py-3"
            onClick={() => startQuiz()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '🎯'}
            <span className="text-xs">{t('life.allDimensions')}</span>
          </Button>
          {DIMENSIONS.map((dim) => {
            const meta = DIMENSION_META[dim];
            return (
              <Button
                key={dim}
                variant="outline"
                className="h-auto flex-col gap-1 py-3"
                onClick={() => startQuiz(dim)}
                disabled={loading}
              >
                <span>{meta.icon}</span>
                <span className="text-xs">{t(meta.labelKey)}</span>
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  if (questions.length === 0) return null;

  const q = questions[currentIndex];
  const dimMeta = DIMENSION_META[q.dimension];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t(dimMeta.labelKey)}</Badge>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1}/{questions.length}
          </span>
        </div>
        <span className="text-sm font-medium text-primary">
          +{totalScore} {t('life.points')}
        </span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full bg-primary transition-all"
          style={{ width: `${((currentIndex + (submitted ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">{q.stem}</p>
      </div>

      {q.options && (
        <div className="space-y-2">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selectedAnswer === letter;
            const isCorrect = submitted && result && letter === result.explanation;
            const isWrong = submitted && isSelected && !result?.correct;

            return (
              <button
                key={i}
                onClick={() => !submitted && setSelectedAnswer(letter)}
                disabled={submitted}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                  !submitted && isSelected && 'border-primary bg-primary/5',
                  !submitted && !isSelected && 'border-border hover:border-primary/40',
                  submitted && isCorrect && 'border-green-500 bg-green-500/10',
                  submitted && isWrong && 'border-red-500 bg-red-500/10',
                  submitted && !isCorrect && !isWrong && 'border-border opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                    !submitted && isSelected && 'bg-primary text-primary-foreground',
                    !submitted && !isSelected && 'bg-muted text-muted-foreground',
                    submitted && isCorrect && 'bg-green-500 text-white',
                    submitted && isWrong && 'bg-red-500 text-white',
                  )}
                >
                  {submitted && isCorrect ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : submitted && isWrong ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    letter
                  )}
                </span>
                <span className="flex-1">{opt}</span>
              </button>
            );
          })}
        </div>
      )}

      {submitted && result && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            result.correct
              ? 'border-green-500/30 bg-green-500/5 text-green-700'
              : 'border-red-500/30 bg-red-500/5 text-red-700',
          )}
        >
          <p className="font-medium">
            {result.correct ? t('life.questionCorrect') : t('life.questionWrong')}
            {result.correct && (
              <span className="ml-2 text-green-600">+{result.scoreGained ?? 0}</span>
            )}
          </p>
          <p className="mt-1 text-xs opacity-80">{result.explanation}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {!submitted ? (
          <Button onClick={submitCurrentAnswer} disabled={!selectedAnswer}>
            {t('life.questionSubmit')}
          </Button>
        ) : (
          <Button onClick={nextQuestion}>
            {currentIndex < questions.length - 1 ? (
              <>
                {t('life.nextQuestion')}
                <ChevronRight className="ml-1 h-4 w-4" />
              </>
            ) : (
              t('life.finishQuiz')
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
