import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api';

interface DashboardConfig {
  pollIntervalMs?: number;
}

type RunStatus = 'pending' | 'running' | 'success' | 'failed';

interface PipelineRun {
  id: string;
  pipeline_id: string;
  status: RunStatus;
  triggered_by: string | null;
  log_path: string | null;
  started_at: number | null;
  finished_at: number | null;
  error?: string | null;
  error_summary?: string | null;
}

type StatusFilter = 'all' | 'success' | 'failed' | 'running';

function toDate(value: number | null | undefined): Date | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Number(value);
  return new Date(n < 1_000_000_000_000 ? n * 1000 : n);
}

function formatDateTime(value: number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function shortId(id: string, len: number): string {
  if (!id) return '—';
  return id.slice(0, len);
}

function runError(run: PipelineRun): string {
  const raw = run.error ?? run.error_summary;
  if (raw == null || raw === '') return '';
  return String(raw);
}

const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'success', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'running', label: '运行中' }
];

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
        success
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/15">
        failed
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/15">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </span>
        running
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
        pending
      </span>
    );
  }
  return <span className="text-xs text-gray-600">{status}</span>;
}

export default function Runs() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pollMs, setPollMs] = useState(60_000);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const loadRuns = useCallback(async () => {
    try {
      const data = await apiFetch('/api/runs/recent');
      setRuns(Array.isArray(data) ? data : []);
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/dashboard/config')
      .then((cfg: DashboardConfig) => {
        const ms = cfg.pollIntervalMs;
        if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 3_000) {
          setPollMs(ms);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const timer = window.setInterval(() => {
      void loadRuns();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, loadRuns]);

  const filteredSorted = useMemo(() => {
    const list =
      filter === 'all'
        ? runs
        : runs.filter((r) => {
            if (filter === 'running') return r.status === 'running';
            return r.status === filter;
          });
    return [...list].sort((a, b) => {
      const ta = toDate(a.started_at)?.getTime() ?? 0;
      const tb = toDate(b.started_at)?.getTime() ?? 0;
      return tb - ta;
    });
  }, [runs, filter]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">Runs</h2>
        <p className="mt-1 text-sm text-gray-500">流水线执行历史</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilter(opt.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium shadow-sm transition ${
                active
                  ? 'bg-blue-600 text-white ring-2 ring-blue-600 ring-offset-1 ring-offset-gray-50'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50/60'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-500">加载中…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-gray-900">暂无执行记录</h3>
          <p className="mt-2 text-sm text-gray-500">当前筛选条件下没有匹配的流水线运行。</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-700">Run ID</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-700">Pipeline ID</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-700">触发人</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-700">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-700">开始时间</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-gray-700">结束时间</th>
                  <th className="min-w-[8rem] px-4 py-3 font-semibold text-gray-700">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSorted.map((run) => {
                  const err = runError(run);
                  const errDisplay = err.length > 80 ? `${err.slice(0, 80)}…` : err;
                  return (
                    <tr key={run.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 font-mono text-xs text-gray-800" title={run.id}>
                        {shortId(run.id, 12)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-800" title={run.pipeline_id}>
                        {shortId(run.pipeline_id, 12)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{run.triggered_by ?? '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDateTime(run.started_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDateTime(run.finished_at)}</td>
                      <td className="max-w-xs px-4 py-3 text-xs text-red-600" title={err || undefined}>
                        {errDisplay || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
