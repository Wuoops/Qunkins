import BetterSqlite3 from 'better-sqlite3';

type MetricType = 'gauge' | 'counter' | 'histogram' | 'summary' | 'untyped';

type SaveMetricInput = {
  server_id: string;
  metric_name: string;
  metric_value: number;
  metric_type?: MetricType;
  labels?: Record<string, string>;
  source?: 'internal' | 'prometheus';
  collected_at?: number;
};

type MetricQueryOptions = {
  serverId?: string;
  metricNames?: string[];
  source?: 'internal' | 'prometheus';
};

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const hasColumn = columns.some((item) => item.name === column);
  if (!hasColumn) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function runMigrations(db: Database): void {
  // Users table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'developer')),
      email TEXT,
      api_key_hash TEXT,
      git_name TEXT,
      git_email TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  ensureColumn(db, 'users', 'git_name', 'TEXT');
  ensureColumn(db, 'users', 'git_email', 'TEXT');

  // Git Repos table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS git_repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('gitlab', 'github', 'gerrit')),
      base_url TEXT NOT NULL,
      access_token_enc TEXT NOT NULL,
      rules_repo INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  // Repo Branches table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS repo_branches (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES git_repos(id),
      branch TEXT NOT NULL,
      pipeline_id TEXT,
      rules_version TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(repo_id, branch)
    )
  `).run();

  // Servers table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ssh', 'k8s')),
      host TEXT NOT NULL,
      port INTEGER,
      credentials_enc TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  // Server Heartbeats table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS server_heartbeats (
      server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
      online INTEGER NOT NULL DEFAULT 0,
      os_info TEXT,
      docker_version TEXT,
      last_check INTEGER DEFAULT (unixepoch()),
      error TEXT
    )
  `).run();

  // Pipelines table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_id TEXT REFERENCES git_repos(id),
      server_id TEXT REFERENCES servers(id),
      config_enc TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  // Pipeline Runs table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'success', 'failed')),
      triggered_by TEXT REFERENCES users(id),
      started_at INTEGER,
      finished_at INTEGER,
      exit_code INTEGER,
      log_path TEXT,
      error_summary TEXT,
      notified INTEGER DEFAULT 0
    )
  `).run();

  // Notify Configs table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notify_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('feishu', 'email')),
      config_enc TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  // Rule Versions table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS rule_versions (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES git_repos(id),
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      synced_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  // Server Metrics table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS server_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL REFERENCES servers(id),
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      metric_type TEXT NOT NULL DEFAULT 'gauge',
      labels_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'internal',
      collected_at INTEGER DEFAULT (unixepoch())
    )
  `).run();

  // Backward-compatible migration for existing databases
  ensureColumn(db, 'server_metrics', 'metric_type', "TEXT NOT NULL DEFAULT 'gauge'");
  ensureColumn(db, 'server_metrics', 'labels_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'server_metrics', 'source', "TEXT NOT NULL DEFAULT 'internal'");

  // Indexes for performance
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_server ON server_metrics(server_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_time ON server_metrics(collected_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON server_metrics(metric_name, collected_at)`).run();
}

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this);
  }

  prepare(sql: string): any {
    return this.db.prepare(sql);
  }

  // ============ Users ============
  createUser(user: {
    id: string;
    username: string;
    role: string;
    email?: string;
    api_key_hash?: string;
    git_name?: string;
    git_email?: string;
  }): void {
    this.db.prepare(
      'INSERT INTO users (id, username, role, email, api_key_hash, git_name, git_email) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      user.id, user.username, user.role,
      user.email || null, user.api_key_hash || null,
      user.git_name || null, user.git_email || null
    );
  }

  getUser(id: string): any {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  getUserByApiKey(apiKeyHash: string): any {
    return this.db.prepare('SELECT * FROM users WHERE api_key_hash = ?').get(apiKeyHash);
  }

  listUsers(): any[] {
    return this.db.prepare('SELECT * FROM users').all();
  }

  getUserByGitIdentity(gitName: string, gitEmail: string): any {
    return this.db.prepare(
      'SELECT * FROM users WHERE git_name = ? AND git_email = ?'
    ).get(gitName, gitEmail);
  }

  updateUserGitIdentity(userId: string, gitName: string, gitEmail: string): void {
    this.db.prepare(
      'UPDATE users SET git_name = ?, git_email = ?, updated_at = unixepoch() WHERE id = ?'
    ).run(gitName, gitEmail, userId);
  }

  // ============ Git Repos ============
  createGitRepo(repo: { id: string; name: string; platform: string; base_url: string; access_token_enc: string }): void {
    this.db.prepare(
      'INSERT INTO git_repos (id, name, platform, base_url, access_token_enc) VALUES (?, ?, ?, ?, ?)'
    ).run(repo.id, repo.name, repo.platform, repo.base_url, repo.access_token_enc);
  }

  listGitRepos(): any[] {
    return this.db.prepare('SELECT * FROM git_repos').all();
  }

  // ============ Servers ============
  createServer(server: { id: string; name: string; type: string; host: string; port?: number; credentials_enc: string }): void {
    this.db.prepare(
      'INSERT INTO servers (id, name, type, host, port, credentials_enc) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(server.id, server.name, server.type, server.host, server.port || null, server.credentials_enc);
  }

  listServers(): any[] {
    return this.db.prepare('SELECT * FROM servers').all();
  }

  getServer(id: string): any {
    return this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  }

  deleteServer(id: string): number {
    this.db.prepare('DELETE FROM server_metrics WHERE server_id = ?').run(id);
    this.db.prepare('DELETE FROM server_heartbeats WHERE server_id = ?').run(id);
    return this.db.prepare('DELETE FROM servers WHERE id = ?').run(id).changes;
  }

  // ============ Server Heartbeats ============
  upsertHeartbeat(serverId: string, data: { online: boolean; os_info?: string; docker_version?: string; error?: string }): void {
    this.db.prepare(`
      INSERT INTO server_heartbeats (server_id, online, os_info, docker_version, last_check, error)
      VALUES (?, ?, ?, ?, unixepoch(), ?)
      ON CONFLICT(server_id) DO UPDATE SET
        online = excluded.online,
        os_info = COALESCE(excluded.os_info, server_heartbeats.os_info),
        docker_version = COALESCE(excluded.docker_version, server_heartbeats.docker_version),
        last_check = excluded.last_check,
        error = excluded.error
    `).run(serverId, data.online ? 1 : 0, data.os_info || null, data.docker_version || null, data.error || null);
  }

  getServerHeartbeats(): any[] {
    return this.db.prepare('SELECT * FROM server_heartbeats').all();
  }

  getServersWithStatus(): any[] {
    return this.db.prepare(`
      SELECT s.id, s.name, s.type, s.host, s.port, s.created_at,
             COALESCE(h.online, 0) as online,
             h.os_info, h.docker_version, h.last_check, h.error as heartbeat_error
      FROM servers s
      LEFT JOIN server_heartbeats h ON s.id = h.server_id
    `).all();
  }

  // ============ Pipelines ============
  createPipeline(pipeline: { id: string; name: string; repo_id?: string; server_id?: string; config_enc: string; created_by?: string }): void {
    this.db.prepare(
      'INSERT INTO pipelines (id, name, repo_id, server_id, config_enc, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(pipeline.id, pipeline.name, pipeline.repo_id || null, pipeline.server_id || null, pipeline.config_enc, pipeline.created_by || null);
  }

  getPipeline(id: string): any {
    return this.db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  }

  listPipelines(): any[] {
    return this.db.prepare('SELECT * FROM pipelines').all();
  }

  updatePipeline(
    id: string,
    pipeline: { name?: string; repo_id?: string; server_id?: string; config_enc?: string }
  ): number {
    const current = this.getPipeline(id);
    if (!current) {
      return 0;
    }

    const nextName = pipeline.name ?? current.name;
    const nextRepoId = pipeline.repo_id ?? current.repo_id;
    const nextServerId = pipeline.server_id ?? current.server_id;
    const nextConfig = pipeline.config_enc ?? current.config_enc;

    const result = this.db
      .prepare(
        'UPDATE pipelines SET name = ?, repo_id = ?, server_id = ?, config_enc = ? WHERE id = ?'
      )
      .run(nextName, nextRepoId, nextServerId, nextConfig, id);

    return result.changes;
  }

  deletePipeline(id: string): number {
    this.db.prepare('DELETE FROM pipeline_runs WHERE pipeline_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
    return result.changes;
  }

  // ============ Pipeline Runs ============
  createPipelineRun(run: {
    id: string;
    pipeline_id: string;
    status: string;
    triggered_by?: string;
    log_path?: string;
  }): void {
    this.db.prepare(
      'INSERT INTO pipeline_runs (id, pipeline_id, status, triggered_by, log_path, started_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      run.id,
      run.pipeline_id,
      run.status,
      run.triggered_by || null,
      run.log_path || null,
      Date.now()
    );
  }

  getPipelineRun(id: string): any {
    return this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id);
  }

  updatePipelineRunStatus(id: string, status: string, errorSummary?: string): void {
    this.db.prepare(`
      UPDATE pipeline_runs 
      SET status = ?, finished_at = ?, error_summary = ?
      WHERE id = ?
    `).run(status, Date.now(), errorSummary || null, id);
  }

  getRecentRuns(limit: number = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM pipeline_runs 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(limit);
  }

  // ============ Notify Configs ============
  createNotifyConfig(config: { id: string; type: string; config_enc: string }): void {
    this.db.prepare(
      'INSERT INTO notify_configs (id, type, config_enc) VALUES (?, ?, ?)'
    ).run(config.id, config.type, config.config_enc);
  }

  listNotifyConfigs(): any[] {
    return this.db.prepare('SELECT * FROM notify_configs').all();
  }

  // ============ Rule Versions ============
  createRuleVersion(version: { id: string; repo_id: string; file_path: string; content_hash: string }): void {
    this.db.prepare(
      'INSERT INTO rule_versions (id, repo_id, file_path, content_hash) VALUES (?, ?, ?, ?)'
    ).run(version.id, version.repo_id, version.file_path, version.content_hash);
  }

  listRuleVersions(repoId?: string, topic?: string): any[] {
    if (repoId && topic) {
      return this.db
        .prepare(
          `SELECT * FROM rule_versions
           WHERE repo_id = ? AND file_path LIKE ?
           ORDER BY synced_at DESC`
        )
        .all(repoId, `%${topic}%`);
    }

    if (repoId) {
      return this.db
        .prepare(
          `SELECT * FROM rule_versions
           WHERE repo_id = ?
           ORDER BY synced_at DESC`
        )
        .all(repoId);
    }

    if (topic) {
      return this.db
        .prepare(
          `SELECT * FROM rule_versions
           WHERE file_path LIKE ?
           ORDER BY synced_at DESC`
        )
        .all(`%${topic}%`);
    }

    return this.db.prepare('SELECT * FROM rule_versions ORDER BY synced_at DESC').all();
  }

  // ============ Metrics ============
  saveMetric(metric: SaveMetricInput): void {
    const labelsJson = JSON.stringify(metric.labels ?? {});
    const metricType = metric.metric_type ?? 'gauge';
    const source = metric.source ?? 'internal';
    const collectedAt = metric.collected_at ?? Math.floor(Date.now() / 1000);

    this.db.prepare(
      `INSERT INTO server_metrics
      (server_id, metric_name, metric_value, metric_type, labels_json, source, collected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      metric.server_id,
      metric.metric_name,
      metric.metric_value,
      metricType,
      labelsJson,
      source,
      collectedAt
    );
  }

  getLatestMetrics(options?: MetricQueryOptions): any[] {
    const params: Array<string | number> = [];
    const conditions: string[] = [];

    if (options?.serverId) {
      conditions.push('m.server_id = ?');
      params.push(options.serverId);
    }

    if (options?.source) {
      conditions.push('m.source = ?');
      params.push(options.source);
    }

    if (options?.metricNames && options.metricNames.length > 0) {
      const placeholders = options.metricNames.map(() => '?').join(', ');
      conditions.push(`m.metric_name IN (${placeholders})`);
      params.push(...options.metricNames);
    }

    const whereClause = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT m.*
      FROM server_metrics m
      WHERE m.id = (
        SELECT m2.id
        FROM server_metrics m2
        WHERE m2.server_id = m.server_id
          AND m2.metric_name = m.metric_name
          AND IFNULL(m2.labels_json, '{}') = IFNULL(m.labels_json, '{}')
        ORDER BY m2.collected_at DESC, m2.id DESC
        LIMIT 1
      )
      ${whereClause}
      ORDER BY m.collected_at ASC
    `).all(...params);

    return this.withParsedLabels(rows);
  }

  getMetricsHistory(hours: number = 24, options?: MetricQueryOptions): any[] {
    const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
    const params: Array<string | number> = [cutoff];
    const conditions: string[] = ['collected_at >= ?'];

    if (options?.serverId) {
      conditions.push('server_id = ?');
      params.push(options.serverId);
    }

    if (options?.source) {
      conditions.push('source = ?');
      params.push(options.source);
    }

    if (options?.metricNames && options.metricNames.length > 0) {
      const placeholders = options.metricNames.map(() => '?').join(', ');
      conditions.push(`metric_name IN (${placeholders})`);
      params.push(...options.metricNames);
    }

    const rows = this.db.prepare(`
      SELECT * FROM server_metrics
      WHERE ${conditions.join(' AND ')}
      ORDER BY collected_at ASC, id ASC
    `).all(...params);

    return this.withParsedLabels(rows);
  }

  listMetricNames(serverId?: string): string[] {
    const rows = (serverId
      ? this.db.prepare(`
          SELECT DISTINCT metric_name
          FROM server_metrics
          WHERE server_id = ?
          ORDER BY metric_name ASC
        `).all(serverId)
      : this.db.prepare(`
          SELECT DISTINCT metric_name
          FROM server_metrics
          ORDER BY metric_name ASC
        `).all()) as Array<{ metric_name: string }>;

    return rows.map((row) => row.metric_name);
  }

  private withParsedLabels(rows: any[]): any[] {
    return rows.map((row) => {
      let labels: Record<string, string> = {};
      if (typeof row.labels_json === 'string' && row.labels_json.length > 0) {
        try {
          labels = JSON.parse(row.labels_json) as Record<string, string>;
        } catch {
          labels = {};
        }
      }

      return {
        ...row,
        labels
      };
    });
  }

  // ============ Cleanup ============
  close(): void {
    this.db.close();
  }
}
