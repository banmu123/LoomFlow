'use client';

import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  ChevronDown,
  ChevronUp,
  Shield,
} from 'lucide-react';
import { useState } from 'react';
import type { GateCheckStatus, GateDecision } from '@/lib/quality-gate/policy';

// ===== Types =====

interface QualityGateCheck {
  name: string;
  level: string;
  status: GateCheckStatus;
  message: string;
  details?: unknown;
  durationMs: number;
}

export interface QualityGateReportData {
  gateEvaluationId: string;
  workflowId: string;
  candidateVersion: number;
  decision: GateDecision;
  checks: QualityGateCheck[];
  blockingReasons: string[];
  warnings: string[];
  summary: string;
  evaluatedAt: string;
}

// ===== Status Icon =====

function StatusIcon({ status }: { status: GateCheckStatus }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case 'fail':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'skip':
      return <SkipForward className="h-4 w-4 text-muted-foreground" />;
  }
}

// ===== Check Name i18n =====

function useCheckLabel(name: string): string {
  const t = useT();
  const map: Record<string, string> = {
    schema: t('qualityGate.schema'),
    static_analysis: t('qualityGate.staticAnalysis'),
    tests: t('qualityGate.tests'),
    regression: t('qualityGate.regression'),
    cost: t('qualityGate.cost'),
    security: t('qualityGate.security'),
  };
  return map[name] ?? name;
}

// ===== Decision Badge =====

function DecisionBadge({ decision }: { decision: GateDecision }) {
  const t = useT();
  const config = {
    allow: { label: t('qualityGate.allow'), className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    warning: { label: t('qualityGate.warning'), className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    block: { label: t('qualityGate.block'), className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  };
  const c = config[decision];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', c.className)}>
      {decision === 'block' && <XCircle className="h-3 w-3" />}
      {decision === 'warning' && <AlertTriangle className="h-3 w-3" />}
      {decision === 'allow' && <CheckCircle2 className="h-3 w-3" />}
      {c.label}
    </span>
  );
}

// ===== Single Check Row =====

function CheckRow({ check }: { check: QualityGateCheck }) {
  const t = useT();
  const label = useCheckLabel(check.name);
  const [expanded, setExpanded] = useState(false);
  const hasDetails = check.details != null;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between px-3 py-2.5 text-sm transition-colors',
          hasDetails && 'hover:bg-muted/50',
        )}
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
      >
        <div className="flex items-center gap-2.5">
          <StatusIcon status={check.status} />
          <span className="font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">
            {t(`qualityGate.${check.status}`)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="max-w-[240px] truncate text-xs text-muted-foreground">
            {check.message}
          </span>
          {hasDetails && (
            expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>
      {expanded && hasDetails && (
        <div className="border-t border-border bg-muted/30 px-3 py-2">
          <CheckDetails check={check} />
        </div>
      )}
    </div>
  );
}

// ===== Check Details =====

function CheckDetails({ check }: { check: QualityGateCheck }) {
  const d = check.details as Record<string, unknown>;
  if (!d) return null;

  // Test results
  if (check.name === 'tests' && d.summary) {
    const summary = d.summary as { passed: number; failed: number; error: number; total: number };
    return (
      <div className="space-y-1 text-xs">
        <p>Total: {summary.total}</p>
        <p className="text-green-600">Passed: {summary.passed}</p>
        {summary.failed > 0 && <p className="text-destructive">Failed: {summary.failed}</p>}
        {summary.error > 0 && <p className="text-destructive">Error: {summary.error}</p>}
      </div>
    );
  }

  // Regression details
  if (check.name === 'regression' && d.metrics) {
    const metrics = d.metrics as Array<{ name: string; baseline: number; candidate: number; deltaPercent: number | null; status: string }>;
    return (
      <div className="space-y-1 text-xs">
        {metrics.filter((m) => m.status === 'regressed').map((m) => (
          <div key={m.name} className="flex items-center gap-2">
            <span className="font-medium">{m.name}</span>
            <span>{m.baseline} → {m.candidate}</span>
            {m.deltaPercent !== null && (
              <span className={m.deltaPercent > 0 ? 'text-destructive' : 'text-green-600'}>
                {m.deltaPercent > 0 ? '+' : ''}{m.deltaPercent.toFixed(1)}%
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Static analysis details
  if (check.name === 'static_analysis' && d.errors) {
    const errors = d.errors as Array<{ code: string; message: string }>;
    const warnings = d.warnings as Array<{ code: string; message: string }>;
    return (
      <div className="space-y-1 text-xs">
        {errors.map((e, i) => <p key={i} className="text-destructive">✕ {e.message}</p>)}
        {warnings.map((w, i) => <p key={i} className="text-amber-600">⚠ {w.message}</p>)}
      </div>
    );
  }

  // Schema details
  if (check.name === 'schema' && Array.isArray(d)) {
    return (
      <div className="space-y-1 text-xs">
        {(d as Array<{ message: string }>).map((e, i) => <p key={i} className="text-destructive">✕ {e.message}</p>)}
      </div>
    );
  }

  // Cost details
  if (check.name === 'cost' && d.cost !== undefined) {
    return (
      <div className="text-xs">
        <p>Cost per run: ${(d.cost as number).toFixed(4)}</p>
        {d.maxCostPerRun !== undefined && <p>Threshold: ${(d.maxCostPerRun as number).toFixed(4)}</p>}
      </div>
    );
  }

  // Fallback: show JSON (truncated)
  const json = JSON.stringify(d, null, 2);
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
      {json.length > 500 ? json.slice(0, 500) + '…' : json}
    </pre>
  );
}

// ===== Main Component =====

export function QualityGateResult({
  report,
  onContinuePublish,
  onCancel,
  loading,
}: {
  report: QualityGateReportData;
  onContinuePublish?: () => void;
  onCancel?: () => void;
  loading?: boolean;
}) {
  const t = useT();
  const passed = report.checks.filter((c) => c.status === 'pass').length;
  const total = report.checks.filter((c) => c.status !== 'skip').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className={cn(
          'h-6 w-6',
          report.decision === 'allow' && 'text-green-600',
          report.decision === 'warning' && 'text-amber-500',
          report.decision === 'block' && 'text-destructive',
        )} />
        <div>
          <h3 className="text-base font-semibold">{t('qualityGate.title')}</h3>
          <p className="text-xs text-muted-foreground">
            v{report.candidateVersion} · {t('qualityGate.passed', { passed, total })}
          </p>
        </div>
        <div className="ml-auto">
          <DecisionBadge decision={report.decision} />
        </div>
      </div>

      {/* Block message */}
      {report.decision === 'block' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {t('qualityGate.blockMessage')}
          {report.blockingReasons.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {report.blockingReasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Warning message */}
      {report.decision === 'warning' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {t('qualityGate.warningMessage')}
        </div>
      )}

      {/* Check list */}
      <div className="space-y-1.5">
        {report.checks.map((check) => (
          <CheckRow key={check.name} check={check} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        {report.decision === 'block' && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80"
          >
            {t('qualityGate.close')}
          </button>
        )}
        {report.decision === 'warning' && (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80"
            >
              {t('qualityGate.cancel')}
            </button>
            <button
              type="button"
              onClick={onContinuePublish}
              disabled={loading}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t('qualityGate.checking') : t('qualityGate.continuePublish')}
            </button>
          </>
        )}
        {report.decision === 'allow' && (
          <button
            type="button"
            onClick={onContinuePublish}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? t('qualityGate.checking') : t('workflows.publish')}
          </button>
        )}
      </div>
    </div>
  );
}
