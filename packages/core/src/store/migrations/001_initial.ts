import type { Database } from '../sqlite';

export function up(db: Database): void {
  // Users table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'developer')),
      email TEXT,
      api_key_hash TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

  // Notify Configs table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notify_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('feishu', 'email')),
      config_enc TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Rule Versions table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS rule_versions (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES git_repos(id),
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      synced_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Server Metrics table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS server_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL REFERENCES servers(id),
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      collected_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Indexes for performance
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_server ON server_metrics(server_id)`);
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_time ON server_metrics(collected_at)`);
}
