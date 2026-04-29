function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: envInt('QUNKINS_PORT', 9800),
  secret: process.env.QUNKINS_SECRET || '',
  dbPath: process.env.QUNKINS_DB_PATH || './data/qunkins.db',
  logDir: process.env.QUNKINS_LOG_DIR || './logs',
  authEnabled: process.env.QUNKINS_AUTH_ENABLED !== 'false',
  bootstrapKey: process.env.QUNKINS_BOOTSTRAP_KEY || '',
  metricsIntervalMs: envInt('QUNKINS_METRICS_INTERVAL_MS', 60_000),
  heartbeatIntervalMs: envInt('QUNKINS_HEARTBEAT_INTERVAL_MS', 60_000),
  dashboardPollIntervalMs: envInt('QUNKINS_DASHBOARD_POLL_MS', 60_000),
};
