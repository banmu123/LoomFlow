'use client';

import { useState } from 'react';
import { Send, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DailyCheckin({ onComplete }: { onComplete?: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/growth/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity: text.trim() }),
      });
      if (res.ok) {
        setDone(true);
        setText('');
        onComplete?.();
      } else {
        toast.error(t('life.checkinFailed'));
      }
    } catch {
      toast.error(t('life.checkinFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle2 className="h-4 w-4" />
        {t('life.checkinDone')}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('life.checkinPlaceholder')}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        disabled={submitting}
        className="text-sm"
      />
      <Button size="sm" onClick={submit} disabled={!text.trim() || submitting}>
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
