import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

interface DashboardConfig {
  pollIntervalMs?: number;
}

interface Pipeline {
  id: string;
  name: string;
  repo_id: string | null;
  server_id: string | null;
  config_enc: string;
  created_by: string | null;
  created_at: number;
}

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

export default function Pipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pollMs, setPollMs] = useState(60_000);
  const [branchById, setBranchById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<'run' | 'delete' | null>(null);

  const loadPipelines = useCallback(async () => {
    try {
      const data = await apiFetch('/api/pipelines');
      setPipelines(Array.isArray(data) ? data : []);
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
    void loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const timer = window.setInterval(() => {
      void loadPipelines();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, loadPipelines]);

  const runPipeline = async (id: string) => {
    const branch = (branchById[id] ?? '').trim();
    setBusyId(id);
    setBusyKind('run');
    try {
      const body = branch.length > 0 ? JSON.stringify({ branch }) : JSON.stringify({});
      await apiFetch(`/api/pipelines/${id}/run`, { method: 'POST', body });
      await loadPipelines();
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : '触发失败');
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  };

  const deletePipeline = async (id: string) => {
    if (!window.confirm('确定要删除该流水线吗？此操作不可恢复。')) return;
    setBusyId(id);
    setBusyKind('delete');
    try {
      await apiFetch(`/api/pipelines/${id}`, { method: 'DELETE' });
      await loadPipelines();
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">Pipelines</h2>
        <p className="mt-1 text-sm text-gray-500">已创建的流水线配置</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-500">加载中…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-gray-900">暂无流水线</h3>
          <p className="mt-2 text-sm text-gray-500">创建流水线后，将在此处展示卡片列表。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {pipelines.map((p) => {
            const busy = busyId === p.id;
            return (
              <div
                key={p.id}
                className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <h3 className="text-xl font-semibold text-gray-900">{p.name}</h3>
                <p className="mt-1 font-mono text-xs text-gray-400 break-all">{p.id}</p>

                <dl className="mt-4 space-y-2 text-sm">
                  {p.server_id ? (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-gray-500">Target Server ID</dt>
                      <dd className="font-mono text-xs text-gray-800 text-right break-all">{p.server_id}</dd>
                    </div>
                  ) : null}
                  {p.repo_id ? (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-gray-500">Target Repo ID</dt>
                      <dd className="font-mono text-xs text-gray-800 text-right break-all">{p.repo_id}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3 border-t border-gray-50 pt-2">
                    <dt className="text-gray-500">创建时间</dt>
                    <dd className="text-gray-800">{formatDateTime(p.created_at)}</dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500">分支（可选）</label>
                  <input
                    type="text"
                    placeholder="默认分支"
                    value={branchById[p.id] ?? ''}
                    onChange={(e) => setBranchById((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-inner outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runPipeline(p.id)}
                    disabled={busy}
                    className="inline-flex flex-1 min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy && busyKind === 'run' ? '执行中…' : '触发执行'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePipeline(p.id)}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy && busyKind === 'delete' ? '删除中…' : '删除'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
