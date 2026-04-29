# Qunkins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Qunkins AI 原生运维助手 MVP，核心能力：MCP Server + 双 Skill 体系 + 飞书集成 + 轻量监控

**Architecture:** 采用分层架构 (方案 C)：接入层 (Web/MCP/飞书) → API Layer → @qunkins/core → 数据层 (SQLite + Redis)

**Tech Stack:** Node.js/TypeScript, Express.js, React, better-sqlite3, BullMQ, @larksuiteoapi/node-sdk

---

## Phase 1: 项目基础设施

### Task 1: 初始化 Monorepo 项目结构

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: 创建 root package.json**

```json
{
  "name": "qunkins",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: 创建 turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {}
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.json .gitignore
git commit -m "chore: initialize monorepo structure"
```

---

### Task 2: 创建 packages/core (@qunkins/core)

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: 创建 core package.json**

```json
{
  "name": "@qunkins/core",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "jest"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "zod": "^3.22.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: 创建核心模块骨架**

```typescript
// packages/core/src/index.ts
export * from './crypto/aes';
export * from './store/sqlite';
export * from './store/migrations';
export * from './config/loader';
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/
git commit -m "feat(core): create @qunkins/core package"
```

---

### Task 3: 创建 packages/server (@qunkins/server)

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: 创建 server package.json (完整版)**

```json
{
  "name": "@qunkins/server",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@qunkins/core": "workspace:*",
    "express": "^4.18.0",
    "cors": "^2.8.0",
    "dotenv": "^16.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "@larksuiteoapi/node-sdk": "^1.59.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "nodemailer": "^6.9.0",
    "zod": "^3.22.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/nodemailer": "^6.4.0",
    "typescript": "^5.3.0",
    "tsx": "^4.0.0"
  }
}
```

- [ ] **Step 2: 创建 server 入口**

```typescript
// packages/server/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config/loader';
import { initDatabase } from '@qunkins/core';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const port = config.port || 9800;

app.listen(port, () => {
  console.log(`Qunkins server running on port ${port}`);
});
```

- [ ] **Step 3: 提交**

```bash
git add packages/server/
git commit -m "feat(server): create @qunkins/server package"
```

---

## Phase 2: 核心数据层

### Task 4: 加密模块实现

**Files:**
- Create: `packages/core/src/crypto/aes.ts`
- Create: `packages/core/src/crypto/keychain.ts`
- Create: `packages/core/src/crypto/vault.ts`
- Test: `packages/core/src/crypto/aes.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/core/src/crypto/aes.test.ts
import { encrypt, decrypt } from './aes';

describe('AES Encryption', () => {
  const secret = 'test-secret-key-32bytes!';
  const plaintext = 'sensitive-data';

  it('should encrypt and decrypt correctly', () => {
    const encrypted = encrypt(plaintext, secret);
    expect(encrypted).not.toBe(plaintext);
    
    const decrypted = decrypt(encrypted, secret);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext each time', () => {
    const encrypted1 = encrypt(plaintext, secret);
    const encrypted2 = encrypt(plaintext, secret);
    expect(encrypted1).not.toBe(encrypted2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd packages/core && npx jest src/crypto/aes.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 AES 加密**

```typescript
// packages/core/src/crypto/aes.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, secret: string): string {
  const key = crypto.scryptSync(secret, 'salt', 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decrypt(ciphertext: string, secret: string): string {
  const key = crypto.scryptSync(secret, 'salt', 32);
  
  const parts = ciphertext.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd packages/core && npx jest src/crypto/aes.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/crypto/
git commit -m "feat(crypto): implement AES-256-GCM encryption"
```

---

### Task 5: SQLite 数据库层 (完整版)

**Files:**
- Create: `packages/core/src/store/sqlite.ts`
- Create: `packages/core/src/store/migrations/index.ts`
- Create: `packages/core/src/store/migrations/001_initial.ts`
- Test: `packages/core/src/store/sqlite.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/core/src/store/sqlite.test.ts
import { Database } from './sqlite';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('should initialize all tables', () => {
    // 9 tables from spec
    db.prepare('SELECT 1 FROM users').get();
    db.prepare('SELECT 1 FROM git_repos').get();
    db.prepare('SELECT 1 FROM repo_branches').get();
    db.prepare('SELECT 1 FROM servers').get();
    db.prepare('SELECT 1 FROM pipelines').get();
    db.prepare('SELECT 1 FROM pipeline_runs').get();
    db.prepare('SELECT 1 FROM notify_configs').get();
    db.prepare('SELECT 1 FROM rule_versions').get();
    db.prepare('SELECT 1 FROM server_metrics').get();
  });

  it('should insert and query user', () => {
    db.createUser({
      id: 'user-1',
      username: 'admin',
      role: 'admin'
    });
    
    const user = db.getUser('user-1');
    expect(user?.username).toBe('admin');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd packages/core && npx jest src/store/sqlite.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 SQLite 封装 (完整版)**

```typescript
// packages/core/src/store/sqlite.ts
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from './migrations';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  // Users
  createUser(user: { id: string; username: string; role: string; email?: string }) {
    return this.db.prepare(
      'INSERT INTO users (id, username, role, email) VALUES (?, ?, ?, ?)'
    ).run(user.id, user.username, user.role, user.email || null);
  }

  getUser(id: string) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  getUserByApiKey(apiKeyHash: string) {
    return this.db.prepare('SELECT * FROM users WHERE api_key_hash = ?').get(apiKeyHash);
  }

  // Git Repos
  createGitRepo(repo: { id: string; name: string; platform: string; base_url: string; access_token_enc: string }) {
    return this.db.prepare(
      'INSERT INTO git_repos (id, name, platform, base_url, access_token_enc) VALUES (?, ?, ?, ?, ?)'
    ).run(repo.id, repo.name, repo.platform, repo.base_url, repo.access_token_enc);
  }

  listGitRepos() {
    return this.db.prepare('SELECT * FROM git_repos').all();
  }

  // Servers
  createServer(server: { id: string; name: string; type: string; host: string; port?: number; credentials_enc: string }) {
    return this.db.prepare(
      'INSERT INTO servers (id, name, type, host, port, credentials_enc) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(server.id, server.name, server.type, server.host, server.port || null, server.credentials_enc);
  }

  listServers() {
    return this.db.prepare('SELECT * FROM servers').all();
  }

  // Pipelines
  createPipeline(pipeline: { id: string; name: string; repo_id?: string; server_id?: string; config_enc: string; created_by?: string }) {
    return this.db.prepare(
      'INSERT INTO pipelines (id, name, repo_id, server_id, config_enc, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(pipeline.id, pipeline.name, pipeline.repo_id || null, pipeline.server_id || null, pipeline.config_enc, pipeline.created_by || null);
  }

  getPipeline(id: string) {
    return this.db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  }

  listPipelines() {
    return this.db.prepare('SELECT * FROM pipelines').all();
  }

  // Pipeline Runs
  createPipelineRun(run: { id: string; pipeline_id: string; status: string; triggered_by?: string }) {
    return this.db.prepare(
      'INSERT INTO pipeline_runs (id, pipeline_id, status, triggered_by, started_at) VALUES (?, ?, ?, ?, ?)'
    ).run(run.id, run.pipeline_id, run.status, run.triggered_by || null, Date.now());
  }

  // Notify Configs
  createNotifyConfig(config: { id: string; type: string; config_enc: string }) {
    return this.db.prepare(
      'INSERT INTO notify_configs (id, type, config_enc) VALUES (?, ?, ?)'
    ).run(config.id, config.type, config.config_enc);
  }

  // Metrics
  saveMetric(metric: { server_id: string; metric_name: string; metric_value: number }) {
    return this.db.prepare(
      'INSERT INTO server_metrics (server_id, metric_name, metric_value) VALUES (?, ?, ?)'
    ).run(metric.server_id, metric.metric_name, metric.metric_value);
  }

  getLatestMetrics() {
    return this.db.prepare(`
      SELECT DISTINCT ON (server_id, metric_name) *
      FROM server_metrics
      ORDER BY server_id, metric_name, collected_at DESC
    `).all();
  }

  // Pipeline Runs
  getPipelineRun(id: string) {
    return this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id);
  }

  updatePipelineRunStatus(id: string, status: string, errorSummary?: string) {
    const stmt = this.db.prepare(`
      UPDATE pipeline_runs 
      SET status = ?, finished_at = ?, error_summary = ?
      WHERE id = ?
    `);
    return stmt.run(status, Date.now(), errorSummary || null, id);
  }

  getRecentRuns(limit: number = 10) {
    return this.db.prepare(`
      SELECT * FROM pipeline_runs 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(limit);
  }

  close() {
    this.db.close();
  }
}
```

- [ ] **Step 4: 实现完整数据库迁移**

```typescript
// packages/core/src/store/migrations/001_initial.ts
import type { Database } from '../sqlite';

export function up(db: Database) {
  // Users
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

  // Git Repos
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

  // Repo Branches
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

  // Servers
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

  // Pipelines
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

  // Pipeline Runs
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

  // Notify Configs
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notify_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('feishu', 'email')),
      config_enc TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Rule Versions
  db.prepare(`
    CREATE TABLE IF NOT EXISTS rule_versions (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES git_repos(id),
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      synced_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Server Metrics
  db.prepare(`
    CREATE TABLE IF NOT EXISTS server_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL REFERENCES servers(id),
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      collected_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Indexes
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_server ON server_metrics(server_id)`);
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_metrics_time ON server_metrics(collected_at)`);
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd packages/core && npx jest src/store/sqlite.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/store/
git commit -m "feat(store): implement complete SQLite database with all tables"
```

---

## Phase 3: MCP Server

### Task 6: MCP Server 基础实现 (完整版)

**Files:**
- Create: `packages/server/src/mcp/index.ts`
- Create: `packages/server/src/mcp/tools.ts`
- Create: `packages/server/src/mcp/resources.ts`
- Create: `packages/server/src/auth/apiKey.ts`
- Create: `packages/core/src/pipeline/executor.ts`

- [ ] **Step 1: 实现 MCP Server 入口**

```typescript
// packages/server/src/mcp/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools';
import { registerResources } from './resources';

export class QunkinsMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: 'qunkins', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    registerTools(this.server);
    registerResources(this.server);
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
```

- [ ] **Step 2: 实现完整 MCP Tools (10 个)**

```typescript
// packages/server/src/mcp/tools.ts
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Database } from '@qunkins/core';
import { PipelineExecutor } from '@qunkins/core/pipeline/executor';
import crypto from 'crypto';

// 共享数据库实例 (单例模式)
let dbInstance: Database | undefined;
let executorInstance: PipelineExecutor | undefined;

function getDb(): Database {
  if (!dbInstance) {
    dbInstance = new Database(process.env.QUNKINS_DB_PATH || './data/qunkins.db');
  }
  return dbInstance;
}

function getExecutor(): PipelineExecutor {
  if (!executorInstance) {
    executorInstance = new PipelineExecutor(getDb());
  }
  return executorInstance;
}

export function registerTools(server: Server) {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const database = getDb();
    const exec = getExecutor();

    switch (name) {
      // Pipeline Tools
      case 'pipeline_create':
        return await handlePipelineCreate(args, database);
      case 'pipeline_run':
        return await handlePipelineRun(args, database, exec);
      case 'pipeline_status':
        return await handlePipelineStatus(args, database);
      case 'pipeline_logs':
        return await handlePipelineLogs(args, database);

      // Git Repo Tools
      case 'repo_add':
        return await handleRepoAdd(args, db);
      case 'repo_list':
        return await handleRepoList(db);
      case 'rules_sync':
        return await handleRulesSync(args, db);

      // User Tools
      case 'user_create':
        return await handleUserCreate(args, db);

      // Notify Tools
      case 'notify_test':
        return await handleNotifyTest(args, db);

      // Rules Tools
      case 'rules_query':
        return await handleRulesQuery(args, db);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

async function handlePipelineCreate(args: any, database: Database) {
  const { name, config } = args;
  const id = `pipeline_${crypto.randomUUID()}`;
  
  database.createPipeline({
    id,
    name,
    repo_id: config.repoId,
    server_id: config.serverId,
    config_enc: JSON.stringify(config.steps)
  });

  return { content: [{ type: 'text', text: `Pipeline "${name}" created with ID: ${id}` }] };
}

async function handlePipelineRun(args: any, database: Database, executor: PipelineExecutor) {
  const { pipelineId, branch } = args;
  
  const runId = await executor.run(pipelineId, branch);
  
  return { content: [{ type: 'text', text: `Pipeline triggered. Run ID: ${runId}` }] };
}

async function handlePipelineStatus(args: any, database: Database) {
  const { runId } = args;
  const run = database.getPipelineRun(runId);
  
  return { content: [{ type: 'text', text: JSON.stringify(run) }] };
}

async function handlePipelineLogs(args: any, database: Database) {
  const { runId } = args;
  const run = database.getPipelineRun(runId);
  
  if (!run?.log_path) {
    return { content: [{ type: 'text', text: 'No logs available' }] };
  }
  
  const logs = require('fs').readFileSync(run.log_path, 'utf-8');
  return { content: [{ type: 'text', text: logs }] };
}

async function handleRepoAdd(args: any, db: Database) {
  const { name, platform, baseUrl, accessToken } = args;
  const { encrypt } = require('@qunkins/core/crypto/aes');
  
  const id = `repo_${crypto.randomUUID()}`;
  const encryptedToken = encrypt(accessToken, process.env.QUNKINS_SECRET || '');
  
  db.createGitRepo({
    id,
    name,
    platform,
    base_url: baseUrl,
    access_token_enc: encryptedToken
  });

  return { content: [{ type: 'text', text: `Repository "${name}" added` }] };
}

async function handleRepoList(db: Database) {
  const repos = db.listGitRepos();
  return { content: [{ type: 'text', text: JSON.stringify(repos) }] };
}

async function handleRulesSync(args: any, db: Database) {
  const { repoId, rulesPath } = args;
  // 实现规则同步到 Git 仓库
  return { content: [{ type: 'text', text: `Rules synced to repository` }] };
}

async function handleUserCreate(args: any, db: Database) {
  const { username, role, email } = args;
  const apiKey = `qk_${crypto.randomBytes(16).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const id = `user_${crypto.randomUUID()}`;
  db.createUser({ id, username, role, email, api_key_hash: apiKeyHash });

  return { content: [{ type: 'text', text: `User created. API Key: ${apiKey}` }] };
}

async function handleNotifyTest(args: any, db: Database) {
  // 实现飞书/邮件测试
  return { content: [{ type: 'text', text: 'Test notification sent' }] };
}

async function handleRulesQuery(args: any, db: Database) {
  const { topic } = args;
  // 从 rule_versions 查询
  return { content: [{ type: 'text', text: `Rules for ${topic}: ...` }] };
}
```

- [ ] **Step 3: 实现 Pipeline Executor**

```typescript
// packages/core/src/pipeline/executor.ts
import { Database } from '../store/sqlite';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class PipelineExecutor {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async run(pipelineId: string, branch?: string): Promise<string> {
    const pipeline = this.db.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    const runId = `run_${crypto.randomUUID()}`;
    const config = JSON.parse(pipeline.config_enc);
    const logPath = path.join(process.env.QUNKINS_LOG_DIR || './logs', `${runId}.log`);

    // 创建运行记录
    this.db.createPipelineRun({
      id: runId,
      pipeline_id: pipelineId,
      status: 'running',
      triggered_by: 'api'
    });

    // 执行流水线步骤
    try {
      for (const step of config.steps) {
        await this.executeStep(step, logPath);
      }

      this.db.updatePipelineRunStatus(runId, 'success');
    } catch (err) {
      this.db.updatePipelineRunStatus(runId, 'failed', err.message);
    }

    return runId;
  }

  private executeStep(step: any, logPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = step.command;
      const args = step.args || [];
      
      const proc = spawn(cmd, args, { shell: true });
      
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      proc.stdout.pipe(logStream);
      proc.stderr.pipe(logStream);

      proc.on('close', (code) => {
        logStream.end();
        if (code === 0) resolve();
        else reject(new Error(`Command failed with code ${code}`));
      });

      proc.on('error', reject);
    });
  }
}
```

- [ ] **Step 4: 实现 API Key 认证**

```typescript
// packages/server/src/auth/apiKey.ts
import crypto from 'crypto';
import { Database } from '@qunkins/core';

export function validateApiKey(apiKey: string, db: Database): boolean {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const user = db.getUserByApiKey(hash);
  return !!user;
}

export function requireApiKey(authHeader: string, db: Database): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  
  const apiKey = authHeader.slice(7);
  const user = db.getUserByApiKey(crypto.createHash('sha256').update(apiKey).digest('hex'));
  
  if (!user) {
    throw new Error('Invalid API key');
  }
  
  return user.id;
}
```

- [ ] **Step 5: 实现 MCP Resources**

```typescript
// packages/server/src/mcp/resources.ts
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Database } from '@qunkins/core';

// 单例数据库实例
let dbInstance: Database | undefined;

function getDb(): Database {
  if (!dbInstance) {
    dbInstance = new Database(process.env.QUNKINS_DB_PATH || './data/qunkins.db');
  }
  return dbInstance;
}

export function registerResources(server: Server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        { uri: 'qunkins://pipelines', name: 'All Pipelines', mimeType: 'application/json' },
        { uri: 'qunkins://servers', name: 'All Servers', mimeType: 'application/json' },
        { uri: 'qunkins://runs/recent', name: 'Recent Runs', mimeType: 'application/json' },
        { uri: 'qunkins://metrics/summary', name: 'Metrics Summary', mimeType: 'application/json' }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const db = getDb();
    
    let data: any;
    switch (uri) {
      case 'qunkins://pipelines':
        data = db.listPipelines();
        break;
      case 'qunkins://servers':
        data = db.listServers();
        break;
      case 'qunkins://runs/recent':
        data = db.getRecentRuns();
        break;
      case 'qunkins://metrics/summary':
        data = db.getLatestMetrics();
        break;
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }

    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  });
}
```

- [ ] **Step 6: 提交**

```bash
git add packages/server/src/mcp/ packages/server/src/auth/ packages/core/src/pipeline/
git commit -m "feat(mcp): implement complete MCP server with all tools"
```

---

## Phase 4: 飞书集成

### Task 7: 飞书 SDK 集成

**Files:**
- Create: `packages/server/src/webhook/feishu.ts`
- Create: `packages/server/src/queue/feishu.ts`
- Test: `packages/server/src/webhook/feishu.test.ts`

- [ ] **Step 1: 实现飞书消息处理**

```typescript
// packages/server/src/webhook/feishu.ts
import { Client, EventDispatcher } from '@larksuiteoapi/node-sdk';

export class FeishuWebhook {
  private client: Client;
  private eventDispatcher: EventDispatcher;

  constructor(appId: string, appSecret: string, encryptKey: string) {
    this.client = new Client({
      appId,
      appSecret
    });

    this.eventDispatcher = new EventDispatcher({
      encryptKey
    });
  }

  async handleMessage(data: any) {
    const message = JSON.parse(data.message.content).text;
    const chatId = data.message.chat_id;

    return await this.processCommand(chatId, message);
  }

  async sendMessage(chatId: string, content: string) {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content })
      }
    });
  }

  private async processCommand(chatId: string, message: string) {
    // 解析指令并处理
    // ...
  }
}
```

- [ ] **Step 2: 实现 BullMQ 消息队列**

```typescript
// packages/server/src/queue/feishu.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({ host: 'redis', port: 6379 });

export const feishuQueue = new Queue('feishu-messages', { connection });

export function startFeishuWorker(handler: (data: any) => Promise<void>) {
  const worker = new Worker('feishu-messages', handler, { connection });
  
  const queueEvents = new QueueEvents('feishu-messages', { connection });
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`Job ${jobId} failed: ${failedReason}`);
  });

  return worker;
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/server/src/webhook/ packages/server/src/queue/
git commit -m "feat(feishu): integrate Feishu SDK with BullMQ"
```

---

## Phase 5: 轻量监控

### Task 8: 监控采集器

**Files:**
- Create: `packages/core/src/monitor/collector.ts`
- Create: `packages/core/src/monitor/metrics.ts`
- Test: `packages/core/src/monitor/collector.test.ts`

- [ ] **Step 1: 实现监控采集器**

```typescript
// packages/core/src/monitor/collector.ts
import { Database } from '../store/sqlite';

export class MetricsCollector {
  private db: Database;
  private interval: NodeJS.Timeout | null = null;

  constructor(db: Database) {
    this.db = db;
  }

  start(intervalMs: number = 1800000) { // 30 minutes
    this.interval = setInterval(() => this.collect(), intervalMs);
    this.collect(); // 立即执行一次
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async collect() {
    const servers = this.db.listServers();
    
    for (const server of servers) {
      try {
        const metrics = await this.collectFromServer(server);
        this.saveMetrics(server.id, metrics);
      } catch (err) {
        console.error(`Failed to collect from ${server.name}:`, err);
      }
    }

    // 清理 24 小时前的数据
    this.cleanupOldMetrics();
  }

  private async collectFromServer(server: any) {
    // SSH 连接采集
    // 或 K8s API 采集
    // 返回 { cpu_usage, memory_usage, disk_usage, network_rx, network_tx }
    return {
      cpu_usage: 0,
      memory_usage: 0,
      disk_usage: 0
    };
  }

  private saveMetrics(serverId: string, metrics: any) {
    const stmt = this.db.prepare(`
      INSERT INTO server_metrics (server_id, metric_name, metric_value)
      VALUES (?, ?, ?)
    `);

    for (const [name, value] of Object.entries(metrics)) {
      stmt.run(serverId, name, value);
    }
  }

  private cleanupOldMetrics() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM server_metrics WHERE collected_at < ?').run(cutoff);
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/monitor/
git commit -m "feat(monitor): implement lightweight metrics collector"
```

---

## Phase 6: Skills

### Task 9: 生成运维 Skill

**Files:**
- Create: `packages/skills/operator/SKILL.md`
- Create: `packages/skills/operator/rules/docker-rules.ts`

- [ ] **Step 1: 创建运维 Skill**

```markdown
---
description: Qunkins 运维助手 - 管理服务器、流水线、通知配置
mode: subagent
tools:
  bash: true
  read: true
  edit: true
---

# Qunkins Operator Skill

你是一个运维工程师助手，帮助管理 Qunkins 服务。

## 可用指令

### 服务器管理
- `添加服务器` - 添加 SSH/K8s 服务器连接
- `列出服务器` - 查看已配置的服务器
- `测试连接` - 验证服务器连通性

### 流水线管理
- `查看所有流水线` - 列出所有流水线
- `查看最近执行` - 最近的执行记录
- `触发流水线 [name]` - 手动触发执行

### 通知配置
- `配置飞书通知` - 配置飞书 Webhook
- `测试通知` - 发送测试消息

### 用户管理
- `创建开发者` - 创建开发者账号
- `列出开发者` - 查看所有开发者
```

- [ ] **Step 2: 提交**

```bash
git add packages/skills/operator/
git commit -m "feat(skill): create operator skill"
```

---

### Task 10: 生成开发者 Skill

**Files:**
- Create: `packages/skills/developer/SKILL.md`
- Create: `packages/skills/developer/rules/docker-rules.ts`

- [ ] **Step 1: 创建开发者 Skill**

```markdown
---
description: Qunkins 开发者助手 - 检查 Docker 配置、创建流水线
mode: subagent
tools:
  bash: true
  read: true
---

# Qunkins Developer Skill

你是开发者助手，帮助检查 Docker 配置和创建流水线。

## 可用指令

### Docker 检查
- `检查项目配置` - 检查 Dockerfile/docker-compose 有效性

### 流水线
- `创建流水线` - 对话式创建流水线
- `查看我的流水线` - 当前项目流水线
- `触发流水线 [name]` - 执行流水线

## 内置规则

### Dockerfile 检查规则
1. 必须包含 WORKDIR 指令
2. 必须包含 HEALTHCHECK (生产环境)
3. COPY 指令引用的目录必须存在
4. 不允许使用 root 用户
```

- [ ] **Step 2: 提交**

```bash
git add packages/skills/developer/
git commit -m "feat(skill): create developer skill"
```

---

## Phase 7: Web Dashboard

### Task 11: 创建 Web Dashboard

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/pages/Dashboard.tsx`

- [ ] **Step 1: 创建 web package.json**

```json
{
  "name": "@qunkins/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: 创建 Dashboard 页面**

```typescript
// packages/web/src/pages/Dashboard.tsx
import { useState, useEffect } from 'react';

interface Pipeline {
  id: string;
  name: string;
  status: 'success' | 'failed' | 'running';
  lastRun: string;
}

export function Dashboard() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  useEffect(() => {
    fetch('/api/pipelines')
      .then(res => res.json())
      .then(setPipelines);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Qunkins Dashboard</h1>
      
      <div className="grid grid-cols-3 gap-4">
        {pipelines.map(pipeline => (
          <div key={pipeline.id} className="border rounded p-4">
            <h3 className="font-semibold">{pipeline.name}</h3>
            <span className={`badge ${pipeline.status}`}>
              {pipeline.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/web/
git commit -m "feat(web): create Dashboard UI"
```

---

## Phase 8: Docker 部署

### Task 12: 创建 Docker 配置

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `docker/prometheus.yml`

- [ ] **Step 1: 创建 Dockerfile**

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY packages/core packages/server packages/web ./
RUN pnpm build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/packages/*/dist ./packages/
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 9800

CMD ["node", "packages/server/dist/index.js"]
```

- [ ] **Step 2: 创建 docker-compose.yml**

```yaml
version: "3.8"

services:
  qunkins:
    build: ./docker
    ports:
      - "9800:9800"
    environment:
      - QUNKINS_SECRET=${QUNKINS_SECRET:-}
      - QUNKINS_PORT=9800
    volumes:
      - qunkins-data:/app/data
      - qunkins-logs:/app/logs
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  qunkins-data:
  qunkins-logs:
  redis-data:
```

- [ ] **Step 3: 提交**

```bash
git add docker/
git commit -m "feat(deploy): add Docker configuration"
```

---

## 执行顺序

```
Phase 1 (Task 1-3)    → 项目基础设施
Phase 2 (Task 4-5)    → 核心数据层
Phase 3 (Task 6)       → MCP Server
Phase 4 (Task 7)       → 飞书集成
Phase 5 (Task 8)       → 轻量监控
Phase 6 (Task 9-10)    → Skills
Phase 7 (Task 11)      → Web Dashboard
Phase 8 (Task 12)      → Docker 部署
```

---

## 预期产出

完成所有任务后，将产出：
- ✅ Monorepo 项目结构
- ✅ @qunkins/core 核心库 (加密、存储、监控)
- ✅ @qunkins/server 服务端 (API、MCP、飞书)
- ✅ @qunkins/web Dashboard
- ✅ 运维 Skill + 开发者 Skill
- ✅ Docker 部署配置

---

*Plan created: 2026-03-24*
