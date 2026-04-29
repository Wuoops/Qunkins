import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';

const METRIC_CPU = 'node_cpu_usage_percent';
const METRIC_MEM = 'node_memory_usage_percent';
const METRIC_DISK = 'node_filesystem_usage_percent';

const DEFAULT_POLL_MS = 60_000;

interface ServerStatusRow {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number | null;
  online: number;
  os_info: string | null;
  docker_version: string | null;
  last_check: number | null;
  heartbeat_error: string | null;
  created_at: number;
}

interface LatestMetricRow {
  server_id: string;
  metric_name: string;
  metric_value: number;
  labels?: Record<string, string>;
}

interface DashboardConfig {
  pollIntervalMs: number;
}

interface TestConnectionResult {
  ok: boolean;
  server: string;
  host: string;
  detail: string;
}

type ToastKind = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

type AuthMode = 'password' | 'key';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatRelativeTimeCN(lastCheckSeconds: number | null | undefined): string {
  if (lastCheckSeconds == null || lastCheckSeconds === 0) {
    return '暂无心跳';
  }
  const nowSec = Math.floor(Date.now() / 1000);
  let diff = nowSec - lastCheckSeconds;
  if (diff < 0) diff = 0;
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff}秒前`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function metricsForServer(
  serverId: string,
  rows: LatestMetricRow[]
): { cpu: number | null; memory: number | null; disk: number | null } {
  let cpu: number | null = null;
  let memory: number | null = null;
  let disk: number | null = null;
  let diskFallback: number | null = null;

  for (const row of rows) {
    if (row.server_id !== serverId) continue;
    if (row.metric_name === METRIC_CPU) {
      cpu = row.metric_value;
    } else if (row.metric_name === METRIC_MEM) {
      memory = row.metric_value;
    } else if (row.metric_name === METRIC_DISK) {
      const mp = row.labels?.mountpoint;
      if (mp === '/') {
        disk = row.metric_value;
      } else if (diskFallback === null) {
        diskFallback = row.metric_value;
      }
    }
  }

  if (disk === null && diskFallback !== null) {
    disk = diskFallback;
  }

  return { cpu, memory, disk };
}

function MiniBar(props: { label: string; value: number | null; colorClass: string }) {
  const pct = props.value == null ? null : clampPercent(props.value);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{props.label}</span>
        <span>{pct == null ? '—' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all duration-300 ${props.colorClass}`}
          style={{ width: pct == null ? '0%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function Servers() {
  const [servers, setServers] = useState<ServerStatusRow[]>([]);
  const [metrics, setMetrics] = useState<LatestMetricRow[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState(DEFAULT_POLL_MS);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState('22');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formPrivateKey, setFormPrivateKey] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('password');

  const [testingId, setTestingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const pushToast = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, kind, title, body }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const fetchDashboardConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch('/api/dashboard/config') as DashboardConfig;
      if (typeof cfg.pollIntervalMs === 'number' && cfg.pollIntervalMs >= 3000) {
        setPollIntervalMs(cfg.pollIntervalMs);
      }
    } catch {
      setPollIntervalMs(DEFAULT_POLL_MS);
    }
  }, []);

  const refreshData = useCallback(async (isInitial = false) => {
    try {
      const metricNames = `${METRIC_CPU},${METRIC_MEM},${METRIC_DISK}`;
      const [statusList, metricList] = await Promise.all([
        apiFetch('/api/servers/status') as Promise<ServerStatusRow[]>,
        apiFetch(`/api/metrics?metricNames=${encodeURIComponent(metricNames)}`) as Promise<LatestMetricRow[]>,
      ]);
      setServers(Array.isArray(statusList) ? statusList : []);
      setMetrics(Array.isArray(metricList) ? metricList : []);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setLoadError(message);
      if (isInitial) {
        pushToast('error', '数据加载失败', message);
      }
    } finally {
      if (isInitial) setInitialLoad(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void fetchDashboardConfig();
  }, [fetchDashboardConfig]);

  useEffect(() => {
    void refreshData(true);
  }, [refreshData]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshData(false);
    }, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [pollIntervalMs, refreshData]);

  const openModal = () => {
    setFormName('');
    setFormHost('');
    setFormPort('22');
    setFormUsername('');
    setFormPassword('');
    setFormPrivateKey('');
    setAuthMode('password');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(formPort, 10);
    const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 22;
    const credentials: Record<string, string> = { username: formUsername.trim() };
    if (authMode === 'password') {
      credentials.password = formPassword;
    } else {
      credentials.privateKey = formPrivateKey;
    }

    if (!formName.trim() || !formHost.trim() || !formUsername.trim()) {
      pushToast('error', '请填写完整', '名称、主机和用户名为必填项。');
      return;
    }
    if (authMode === 'password' && !formPassword) {
      pushToast('error', '请填写密码');
      return;
    }
    if (authMode === 'key' && !formPrivateKey.trim()) {
      pushToast('error', '请粘贴 SSH 私钥');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: formName.trim(),
          type: 'ssh',
          host: formHost.trim(),
          port,
          credentials,
        }),
      });
      pushToast('success', '节点已添加');
      setModalOpen(false);
      await refreshData(false);
    } catch (err) {
      pushToast('error', '添加失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (server: ServerStatusRow) => {
    setTestingId(server.id);
    try {
      const result = (await apiFetch(`/api/servers/${encodeURIComponent(server.id)}/test`, {
        method: 'POST',
      })) as TestConnectionResult;
      if (result.ok) {
        pushToast('success', '连接成功', result.detail);
      } else {
        pushToast('error', '连接失败', result.detail);
      }
    } catch (err) {
      pushToast('error', '连接测试出错', err instanceof Error ? err.message : String(err));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (server: ServerStatusRow) => {
    const ok = window.confirm(`确定删除节点「${server.name}」？此操作不可恢复。`);
    if (!ok) return;
    try {
      await apiFetch(`/api/servers/${encodeURIComponent(server.id)}`, { method: 'DELETE' });
      pushToast('success', '已删除节点');
      await refreshData(false);
    } catch (err) {
      pushToast('error', '删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  }, [servers]);

  if (initialLoad) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        加载中…
      </div>
    );
  }

  return (
    <div className="relative space-y-8 pb-10">
      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm transition ${
              toast.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900'
                : toast.kind === 'error'
                  ? 'border-red-200 bg-red-50/95 text-red-900'
                  : 'border-gray-200 bg-white/95 text-gray-900'
            }`}
          >
            <div className="font-semibold">{toast.title}</div>
            {toast.body ? (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-xs opacity-90">
                {toast.body}
              </pre>
            ) : null}
          </div>
        ))}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      ) : null}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Execution Nodes</h1>
          <p className="mt-1 text-sm text-gray-500">
            管理执行节点与连接状态 · 每 {Math.round(pollIntervalMs / 1000)} 秒自动刷新
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          添加节点
        </button>
      </header>

      {sortedServers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center text-gray-500">
          暂无执行节点，点击右上角「添加节点」开始配置。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sortedServers.map((server) => {
            const online = server.online === 1;
            const hostLine = `${server.host}:${server.port ?? 22}`;
            const m = metricsForServer(server.id, metrics);

            return (
              <article
                key={server.id}
                className="flex flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-bold text-gray-900">{server.name}</h2>
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-xs font-medium">
                    <span
                      className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`}
                      aria-hidden
                    />
                    <span className={online ? 'text-emerald-700' : 'text-red-700'}>
                      {online ? '在线' : '离线'}
                    </span>
                  </div>
                </div>

                <p className="mt-2 font-mono text-sm text-gray-600">{hostLine}</p>

                <dl className="mt-4 space-y-2 text-sm text-gray-600">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">操作系统</dt>
                    <dd className="mt-0.5">{server.os_info?.trim() || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Docker</dt>
                    <dd className="mt-0.5 break-all">{server.docker_version?.trim() || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">上次心跳</dt>
                    <dd className="mt-0.5 text-gray-800">{formatRelativeTimeCN(server.last_check)}</dd>
                  </div>
                </dl>

                {!online && server.heartbeat_error ? (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {server.heartbeat_error}
                  </p>
                ) : null}

                <div className="mt-5 space-y-3 rounded-xl bg-gray-50/80 p-4">
                  <MiniBar label="CPU" value={m.cpu} colorClass="bg-blue-500" />
                  <MiniBar label="内存" value={m.memory} colorClass="bg-emerald-500" />
                  <MiniBar label="磁盘" value={m.disk} colorClass="bg-amber-500" />
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={testingId === server.id}
                    onClick={() => void handleTest(server)}
                    className="inline-flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testingId === server.id ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                        测试中…
                      </>
                    ) : (
                      '测试连接'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(server)}
                    className="inline-flex flex-1 min-w-[120px] items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-server-title"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="add-server-title" className="text-lg font-bold text-gray-900">
                添加执行节点
              </h2>
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                aria-label="关闭"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleAddServer}>
              <div>
                <label className="block text-sm font-medium text-gray-700">名称</label>
                <input
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="例如：生产构建机"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">主机</label>
                <input
                  required
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="IP 或域名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">端口</label>
                <input
                  value={formPort}
                  onChange={(e) => setFormPort(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="22"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">用户名</label>
                <input
                  required
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="root"
                />
              </div>

              <div className="flex rounded-xl border border-gray-200 p-1">
                <button
                  type="button"
                  onClick={() => setAuthMode('password')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                    authMode === 'password' ? 'bg-blue-600 text-white shadow' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  密码认证
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('key')}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                    authMode === 'key' ? 'bg-blue-600 text-white shadow' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  密钥认证
                </button>
              </div>

              {authMode === 'password' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700">密码</label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    autoComplete="new-password"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700">SSH 私钥（可选格式：PEM）</label>
                  <textarea
                    value={formPrivateKey}
                    onChange={(e) => setFormPrivateKey(e.target.value)}
                    rows={8}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="-----BEGIN ... PRIVATE KEY-----"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                      提交中…
                    </>
                  ) : (
                    '保存'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
