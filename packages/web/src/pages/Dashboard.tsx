import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { apiFetch } from '../utils/api';

const DEFAULT_POLL_MS = 60_000;
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;
const CHART_BUCKET_SEC = 1800;

const TREND_METRIC_IDS = [
  'node_cpu_usage_percent',
  'node_memory_usage_percent',
  'node_filesystem_usage_percent'
] as const;

type TrendMetricId = (typeof TREND_METRIC_IDS)[number];

const TREND_METRIC_META: Record<
  TrendMetricId,
  { label: string; color: string }
> = {
  node_cpu_usage_percent: { label: 'CPU 使用率', color: '#2563eb' },
  node_memory_usage_percent: { label: '内存使用率', color: '#059669' },
  node_filesystem_usage_percent: { label: '/ 磁盘使用率', color: '#d97706' }
};

interface Pipeline {
  id: string;
  name: string;
  repo_id?: string | null;
  server_id?: string | null;
}

interface ServerStatus {
  id: string;
  name: string;
  type: string;
  host: string;
  port?: number | null;
  online: 0 | 1;
  os_info?: string | null;
  docker_version?: string | null;
  last_check?: number | null;
  heartbeat_error?: string | null;
  created_at?: number;
}

interface MetricRow {
  server_id: string;
  metric_name: string;
  metric_value: number;
  collected_at: number;
  labels?: Record<string, string>;
  source?: string;
}

type RunStatus = 'pending' | 'running' | 'success' | 'failed';

interface RecentRun {
  id: string;
  pipeline_id: string;
  status: RunStatus;
  triggered_by: string | null;
  log_path?: string | null;
  started_at: number;
  finished_at?: number | null;
  error?: string | null;
  error_summary?: string | null;
}

type MetricSeries = {
  key: string;
  name: string;
  color: string;
  strokeDasharray?: string;
};

const STROKE_DASH_PATTERNS = ['', '6 4', '3 4', '10 4'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatHostPort(host: string, port?: number | null): string {
  if (port === undefined || port === null || port === 0) {
    return host;
  }
  return `${host}:${port}`;
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1)}%`;
}

function formatRunTime(startedAt: number, finishedAt?: number | null): string {
  const start = new Date(startedAt);
  const end = finishedAt ? new Date(finishedAt) : null;
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
      d.getHours()
    ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (!end) {
    return fmt(start);
  }
  return `${fmt(start)} → ${fmt(end)}`;
}

function truncateRunId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 10)}…`;
}

function isRootFilesystemMetric(metric: MetricRow): boolean {
  const mp = metric.labels?.mountpoint;
  return mp === undefined || mp === '' || mp === '/';
}

function pickLatestMetric(
  rows: MetricRow[],
  serverId: string,
  metricName: string,
  predicate?: (row: MetricRow) => boolean
): MetricRow | undefined {
  let best: MetricRow | undefined;
  for (const row of rows) {
    if (row.server_id !== serverId || row.metric_name !== metricName) continue;
    if (predicate && !predicate(row)) continue;
    if (!best || row.collected_at > best.collected_at) {
      best = row;
    }
  }
  return best;
}

function getTrendMetricDefinition(metricName: string): { label: string; color: string } | undefined {
  if (TREND_METRIC_IDS.includes(metricName as TrendMetricId)) {
    return TREND_METRIC_META[metricName as TrendMetricId];
  }
  return undefined;
}

export default function Dashboard() {
  const [pollIntervalMs, setPollIntervalMs] = useState(DEFAULT_POLL_MS);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [serverStatuses, setServerStatuses] = useState<ServerStatus[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [latestMetrics, setLatestMetrics] = useState<MetricRow[]>([]);
  const [historyMetrics, setHistoryMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isFirstLoad = useRef(true);
  const [selectedServerId, setSelectedServerId] = useState<string>('all');
  const [selectedMetricNames, setSelectedMetricNames] = useState<string[]>([...TREND_METRIC_IDS]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw: unknown = await apiFetch('/api/dashboard/config');
        const poll = isRecord(raw) ? raw.pollIntervalMs : undefined;
        const n = typeof poll === 'number' && Number.isFinite(poll) && poll >= 1000 ? poll : DEFAULT_POLL_MS;
        if (!cancelled) setPollIntervalMs(n);
      } catch {
        if (!cancelled) setPollIntervalMs(DEFAULT_POLL_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshDashboard = useCallback(async () => {
    if (isFirstLoad.current) {
      setLoading(true);
    }
    try {
      const [
        pipelinesRes,
        serversStatusRes,
        runsRes,
        metricsRes,
        historyRes
      ] = await Promise.all([
        apiFetch('/api/pipelines').catch(() => []),
        apiFetch('/api/servers/status').catch(() => []),
        apiFetch('/api/runs/recent').catch(() => []),
        apiFetch('/api/metrics').catch(() => []),
        apiFetch('/api/metrics/history?hours=24').catch(() => [])
      ]);

      setPipelines(asArray<Pipeline>(pipelinesRes));
      setServerStatuses(asArray<ServerStatus>(serversStatusRes));
      setRecentRuns(asArray<RecentRun>(runsRes));
      setLatestMetrics(asArray<MetricRow>(metricsRes));
      setHistoryMetrics(asArray<MetricRow>(historyRes));
    } finally {
      if (isFirstLoad.current) {
        setLoading(false);
        isFirstLoad.current = false;
      }
    }
  }, []);

  useEffect(() => {
    void refreshDashboard();
    const timer = window.setInterval(() => {
      void refreshDashboard();
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [pollIntervalMs, refreshDashboard]);

  const pipelineNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pipelines) {
      map.set(p.id, p.name);
    }
    return map;
  }, [pipelines]);

  const runsLast24h = useMemo(() => {
    const cutoff = Date.now() - TWENTY_FOUR_H_MS;
    return recentRuns.filter((r) => typeof r.started_at === 'number' && r.started_at >= cutoff);
  }, [recentRuns]);

  const stats = useMemo(() => {
    const totalPipelines = pipelines.length;
    const executionNodes = serverStatuses.length;
    const recentCount24h = runsLast24h.length;
    const successes = runsLast24h.filter((r) => r.status === 'success').length;
    const successRate =
      recentCount24h > 0 ? Math.round((successes / recentCount24h) * 1000) / 10 : null;

    return {
      totalPipelines,
      executionNodes,
      recentCount24h,
      successRate
    };
  }, [pipelines.length, serverStatuses.length, runsLast24h]);

  const serverById = useMemo(() => {
    return new Map(serverStatuses.map((s) => [s.id, s]));
  }, [serverStatuses]);

  const availableTrendDefinitions = useMemo(() => {
    const names = new Set(historyMetrics.map((m) => m.metric_name));
    return TREND_METRIC_IDS.filter((id) => names.has(id));
  }, [historyMetrics]);

  useEffect(() => {
    if (availableTrendDefinitions.length === 0) return;
    setSelectedMetricNames((current) => {
      const valid = current.filter((name) => availableTrendDefinitions.includes(name as TrendMetricId));
      if (valid.length > 0) return valid;
      return [...availableTrendDefinitions];
    });
  }, [availableTrendDefinitions]);

  const filteredHistory = useMemo(() => {
    const selected = new Set(selectedMetricNames);
    return historyMetrics.filter((item) => {
      if (!selected.has(item.metric_name)) return false;
      if (selectedServerId !== 'all' && item.server_id !== selectedServerId) return false;
      if (item.metric_name === 'node_filesystem_usage_percent' && !isRootFilesystemMetric(item)) {
        return false;
      }
      return true;
    });
  }, [historyMetrics, selectedMetricNames, selectedServerId]);

  const seriesList = useMemo<MetricSeries[]>(() => {
    const seriesMap = new Map<string, MetricSeries>();
    const serverOrder = new Map<string, number>();
    serverStatuses.forEach((s, i) => serverOrder.set(s.id, i));

    for (const metric of filteredHistory) {
      const definition = getTrendMetricDefinition(metric.metric_name);
      if (!definition) continue;

      const key = `${metric.server_id}::${metric.metric_name}`;
      if (seriesMap.has(key)) continue;

      const server = serverById.get(metric.server_id);
      const serverLabel = server?.name ?? metric.server_id;
      const dashIndex = serverOrder.get(metric.server_id) ?? 0;

      seriesMap.set(key, {
        key,
        name: selectedServerId === 'all' ? `${serverLabel} · ${definition.label}` : definition.label,
        color: definition.color,
        strokeDasharray:
          selectedServerId === 'all' ? STROKE_DASH_PATTERNS[dashIndex % STROKE_DASH_PATTERNS.length] : undefined
      });
    }

    return Array.from(seriesMap.values());
  }, [filteredHistory, selectedServerId, serverById, serverStatuses]);

  const chartData = useMemo(() => {
    const grouped = new Map<number, Record<string, number>>();

    for (const metric of filteredHistory) {
      const timeBucket = Math.floor(metric.collected_at / CHART_BUCKET_SEC) * CHART_BUCKET_SEC * 1000;
      const key = `${metric.server_id}::${metric.metric_name}`;

      if (!grouped.has(timeBucket)) {
        grouped.set(timeBucket, {});
      }
      const bucket = grouped.get(timeBucket);
      if (bucket) {
        bucket[key] = metric.metric_value;
      }
    }

    return Array.from(grouped.entries())
      .map(([time, values]) => ({ time, ...values }))
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [filteredHistory]);

  const seriesByKey = useMemo(() => new Map(seriesList.map((s) => [s.key, s])), [seriesList]);

  const formatChartTick = (time: number) => {
    const d = new Date(time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const statusBadgeClass = (status: RunStatus) => {
    switch (status) {
      case 'success':
        return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
      case 'failed':
        return 'bg-red-50 text-red-700 ring-red-600/20';
      case 'running':
        return 'bg-blue-50 text-blue-700 ring-blue-600/20';
      default:
        return 'bg-gray-100 text-gray-600 ring-gray-500/10';
    }
  };

  const statusLabel = (status: RunStatus) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'failed':
        return 'failed';
      case 'running':
        return 'running';
      case 'pending':
        return 'pending';
      default:
        return status;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">流水线与执行节点的运行概览，数据按配置间隔自动刷新。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-blue-50 p-3 text-blue-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-500">Total Pipelines</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{loading ? '—' : stats.totalPipelines}</p>
              <p className="mt-1 text-xs text-gray-500">已配置的流水线总数（/api/pipelines）</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-blue-50 p-3 text-blue-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-500">Execution Nodes</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{loading ? '—' : stats.executionNodes}</p>
              <p className="mt-1 text-xs text-gray-500">执行节点数量（/api/servers/status）</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-gray-100 p-3 text-gray-700">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-500">Recent Runs 24h</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{loading ? '—' : stats.recentCount24h}</p>
              <p className="mt-1 text-xs text-gray-500">近 24 小时内的运行次数（基于最近记录时间过滤）</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-emerald-50 p-3 text-emerald-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-500">Success Rate</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {loading ? '—' : stats.successRate === null ? '—' : `${stats.successRate}%`}
              </p>
              <p className="mt-1 text-xs text-gray-500">近 24 小时记录中 status 为 success 的占比（成功次数 / 总次数）</p>
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">Node Status Overview</h2>
          <p className="mt-1 text-sm text-gray-500">各执行节点在线状态与最新资源指标（/api/metrics）。</p>
        </div>
        <div className="p-6">
          {serverStatuses.length === 0 ? (
            <p className="text-sm text-gray-500">暂无节点数据，或当前账号无权限访问节点状态接口。</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {serverStatuses.map((node) => {
                const online = node.online === 1;
                const cpu = pickLatestMetric(latestMetrics, node.id, 'node_cpu_usage_percent');
                const mem = pickLatestMetric(latestMetrics, node.id, 'node_memory_usage_percent');
                const disk = pickLatestMetric(
                  latestMetrics,
                  node.id,
                  'node_filesystem_usage_percent',
                  isRootFilesystemMetric
                );
                return (
                  <div
                    key={node.id}
                    className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 shadow-sm ring-1 ring-gray-900/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{node.name}</p>
                        <p className="mt-0.5 truncate text-xs text-gray-500">{formatHostPort(node.host, node.port)}</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                        <span
                          className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`}
                          aria-hidden
                        />
                        {online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-white px-2 py-2 ring-1 ring-gray-100">
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">CPU</dt>
                        <dd className="mt-0.5 text-sm font-semibold text-gray-900">{formatPercent(cpu?.metric_value)}</dd>
                      </div>
                      <div className="rounded-lg bg-white px-2 py-2 ring-1 ring-gray-100">
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Memory</dt>
                        <dd className="mt-0.5 text-sm font-semibold text-gray-900">{formatPercent(mem?.metric_value)}</dd>
                      </div>
                      <div className="rounded-lg bg-white px-2 py-2 ring-1 ring-gray-100">
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Disk /</dt>
                        <dd className="mt-0.5 text-sm font-semibold text-gray-900">{formatPercent(disk?.metric_value)}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">Recent Runs</h2>
          <p className="mt-1 text-sm text-gray-500">最近的流水线执行记录。</p>
        </div>
        <div className="overflow-x-auto px-6 py-4">
          {recentRuns.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">暂无运行记录。</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead>
                <tr className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-3 pr-4">Run ID</th>
                  <th className="py-3 pr-4">触发人</th>
                  <th className="py-3 pr-4">分支</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentRuns.map((run) => (
                  <tr key={run.id} className="text-gray-700">
                    <td className="py-3 pr-4 font-mono text-xs text-gray-900">{truncateRunId(run.id)}</td>
                    <td className="py-3 pr-4">{run.triggered_by ?? '—'}</td>
                    <td className="py-3 pr-4">{pipelineNameById.get(run.pipeline_id) ?? '—'}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass(
                          run.status
                        )}`}
                      >
                        {statusLabel(run.status)}
                      </span>
                    </td>
                    <td className="py-3 whitespace-nowrap text-xs text-gray-600">
                      {formatRunTime(run.started_at, run.finished_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">Resource Trend Chart</h2>
          <p className="mt-1 text-sm text-gray-500">过去 24 小时 CPU / 内存 / 根分区磁盘使用率趋势（/api/metrics/history）。</p>
        </div>

        <div className="space-y-4 border-b border-gray-100 px-6 py-4">
          <div>
            <label htmlFor="dashboard-server-filter" className="text-sm font-medium text-gray-700">
              Server
            </label>
            <select
              id="dashboard-server-filter"
              className="mt-2 block w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
            >
              <option value="all">All servers</option>
              {serverStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">按节点筛选折线数据。</p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700">Metrics</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TREND_METRIC_IDS.map((id) => {
                const meta = TREND_METRIC_META[id];
                const inData = availableTrendDefinitions.includes(id);
                const checked = selectedMetricNames.includes(id);
                return (
                  <label
                    key={id}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                      checked ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-600'
                    } ${!inData ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={checked}
                      disabled={!inData}
                      onChange={() => {
                        setSelectedMetricNames((current) => {
                          if (current.includes(id)) {
                            if (current.length === 1) return current;
                            return current.filter((n) => n !== id);
                          }
                          return [...current, id];
                        });
                      }}
                    />
                    {meta.label}
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-gray-500">勾选需要对比的指标；磁盘默认仅统计挂载点为 / 的样本。</p>
          </div>
        </div>

        <div className="p-6">
          {!loading && chartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">暂无指标历史数据，或当前账号无权限访问监控接口。</p>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={formatChartTick}
                    stroke="#9ca3af"
                    fontSize={12}
                    tickMargin={8}
                  />
                  <YAxis stroke="#9ca3af" fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    labelFormatter={(label) => new Date(label as number).toLocaleString()}
                    formatter={(value, _name, item) => {
                      const key = String((item as { dataKey?: string }).dataKey ?? '');
                      const series = seriesByKey.get(key);
                      const label = series?.name ?? key;
                      if (value === undefined || value === null) {
                        return ['—', label];
                      }
                      const num = typeof value === 'number' ? value : Number(value);
                      return [`${Number.isFinite(num) ? num.toFixed(1) : '—'}%`, label];
                    }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 16 }} />
                  {seriesList.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      name={series.name}
                      stroke={series.color}
                      strokeWidth={2}
                      strokeDasharray={series.strokeDasharray}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
