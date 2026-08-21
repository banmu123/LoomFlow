'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, ChevronLeft, Loader2, Sparkles, CheckCircle2, RefreshCw } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AbilityScores } from '@/lib/growth/ability-types';

interface AssessmentQuestion {
  id: string;
  stem: string;
  type: 'single' | 'multi';
  options: Array<{ id: string; text: string }>;
}

interface AssessmentAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

interface ModelOption {
  value: string;
  label: string;
}

interface Props {
  onComplete: (scores: AbilityScores, analysis: string) => void;
  onSkip: () => void;
}

type Phase = 'ready' | 'loading' | 'answering' | 'analyzing';

export function AssessmentPanel({ onComplete, onSkip }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('ready');
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ai/models');
        const data = await res.json();
        if (Array.isArray(data)) {
          const options = data.map((m: { id: string; label: string | null }) => ({
            value: m.id,
            label: m.label || m.id,
          }));
          setModelOptions(options);
          if (options.length > 0) setSelectedModel(options[0].value);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const currentQuestion = questions[currentStep];
  const progress = questions.length > 0 ? ((currentStep + 1) / questions.length) * 100 : 0;
  const isLast = currentStep === questions.length - 1;
  const selectedOptions = currentQuestion ? (answers[currentQuestion.id] ?? []) : [];
  const canProceed = selectedOptions.length > 0;

  const handleGenerate = async () => {
    setPhase('loading');
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedModel) params.set('modelId', selectedModel);
      const res = await fetch(`/api/growth/assessment?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || t('life.generateAssessmentFailed'));
        setPhase('ready');
        return;
      }
      if (Array.isArray(data) && data.length > 0) {
        setQuestions(data);
        setPhase('answering');
      } else {
        setError(t('life.generateAssessmentFailed'));
        setPhase('ready');
      }
    } catch {
      setError(t('life.generateAssessmentFailed'));
      setPhase('ready');
    }
  };

  const handleSelect = (optionId: string) => {
    if (!currentQuestion) return;
    const qId = currentQuestion.id;

    if (currentQuestion.type === 'single') {
      setAnswers((prev) => ({ ...prev, [qId]: [optionId] }));
    } else {
      setAnswers((prev) => {
        const current = prev[qId] ?? [];
        const next = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        return { ...prev, [qId]: next };
      });
    }
  };

  const handleNext = () => {
    if (isLast) {
      handleSubmit();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  const handleSubmit = async () => {
    setPhase('analyzing');
    try {
      const answerList: AssessmentAnswer[] = Object.entries(answers).map(([questionId, selectedOptionIds]) => ({
        questionId,
        selectedOptionIds,
      }));

      const res = await fetch('/api/growth/assessment/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, answers: answerList, modelId: selectedModel }),
      });

      const data = await res.json();
      if (res.ok && data.scores) {
        onComplete(data.scores, data.analysis || '');
      } else {
        setError(data?.error || t('life.analyzeAssessmentFailed'));
        setPhase('answering');
      }
    } catch {
      setError(t('life.analyzeAssessmentFailed'));
      setPhase('answering');
    }
  };

  // 阶段 1：准备页（点击生成题库）
  if (phase === 'ready') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <Sparkles className="mx-auto h-12 w-12 text-primary" />
          <h1 className="text-2xl font-bold">{t('life.welcomeTitle')}</h1>
          <p className="text-muted-foreground">{t('life.welcomeDesc')}</p>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {modelOptions.length > 0 && (
            <div className="mx-auto max-w-xs">
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('life.selectModel')} />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button size="lg" onClick={handleGenerate} className="w-full" disabled={!selectedModel}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t('life.generateQuestions')}
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            {t('life.skipAssessment')}
          </Button>
        </div>
      </div>
    );
  }

  // 阶段 2：加载中（AI 生成题目）
  if (phase === 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="space-y-4 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('life.generatingQuestions')}</p>
        </div>
      </div>
    );
  }

  // 阶段 3：分析中
  if (phase === 'analyzing') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="space-y-4 text-center">
          <Sparkles className="mx-auto h-10 w-10 animate-pulse text-primary" />
          <h2 className="text-lg font-semibold">{t('life.analyzing')}</h2>
          <p className="text-sm text-muted-foreground">{t('life.analyzingDesc')}</p>
        </div>
      </div>
    );
  }

  // 阶段 4：答题
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* 头部 */}
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t('life.welcomeTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('life.welcomeDesc')}</p>
        </div>

        {/* 进度条 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{currentStep + 1} / {questions.length}</span>
            <span>{currentQuestion.type === 'multi' ? t('life.multiSelect') : t('life.singleSelect')}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 问题 */}
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-base font-medium text-foreground">{currentQuestion.stem}</p>

          <div className="mt-4 space-y-2">
            {currentQuestion.options.map((opt) => {
              const isSelected = selectedOptions.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {isSelected ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      opt.id.toUpperCase()
                    )}
                  </span>
                  <span className="flex-1">{opt.text}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={currentStep === 0 ? onSkip : handlePrev}
          >
            {currentStep === 0 ? t('life.skipAssessment') : (
              <>
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t('common.back')}
              </>
            )}
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canProceed}
          >
            {isLast ? (
              <Sparkles className="mr-1 h-4 w-4" />
            ) : null}
            {isLast ? t('life.viewResults') : t('common.next')}
            {!isLast && <ChevronRight className="ml-1 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
