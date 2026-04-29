import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../..', '.env') });

import express from 'express';
import cors from 'cors';
import { config } from './config/loader';
import {
  Database, PipelineExecutor, PipelineScheduler, encrypt,
  analyzeFailure, scanDockerProject, buildSkillPrompt, MetricsCollector,
  RemoteExecutor, generatePipelineYaml, parsePipelineYamlString,
  HeartbeatChecker
} from '@qunkins/core';
import { createAuthMiddleware, generateApiKey, RequestWithUser } from './auth/apiKey';
import crypto from 'crypto';

const app = express();
const dbPath = config.dbPath;
const secret = config.secret || 'default-secret';

app.use(cors());
app.use(express.json());

const requireAuth = (reqRoles: Array<'admin' | 'developer'> = ['admin', 'developer']) =>
  createAuthMiddleware(dbPath || './data/qunkins.db', reqRoles);

const schedulerDb = new Database(dbPath || './data/qunkins.db');
const pipelineScheduler = new PipelineScheduler(schedulerDb);
const metricsCollector = new MetricsCollector(schedulerDb, config.metricsIntervalMs);
metricsCollector.start();
const heartbeatChecker = new HeartbeatChecker(schedulerDb, secret, config.heartbeatIntervalMs);
heartbeatChecker.start();

const remoteExecutor = new RemoteExecutor(
  schedulerDb, secret, process.env.QUNKINS_LOG_DIR || './logs'
);

function createDatabase() {
  return new Database(dbPath || './data/qunkins.db');
}

process.on('SIGINT', () => {
  pipelineScheduler.stopAll();
  metricsCollector.stop();
  heartbeatChecker.stop();
  schedulerDb.close();
});
process.on('SIGTERM', () => {
  pipelineScheduler.stopAll();
  metricsCollector.stop();
  heartbeatChecker.stop();
  schedulerDb.close();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'qunkins-server' });
});

app.post('/api/bootstrap/admin', (req, res) => {
  const bootstrapKey = process.env.QUNKINS_BOOTSTRAP_KEY || '';
  const providedKey = req.body?.bootstrapKey || '';
  const username = req.body?.username || 'admin';

  if (!bootstrapKey) {
    res.status(403).json({ error: 'QUNKINS_BOOTSTRAP_KEY is not configured' });
    return;
  }
  if (providedKey !== bootstrapKey) {
    res.status(401).json({ error: 'Invalid bootstrap key' });
    return;
  }

  const db = createDatabase();
  try {
    const exists = db.listUsers();
    if (exists.length > 0) {
      res.status(409).json({ error: 'Bootstrap is not allowed when users already exist' });
      return;
    }

    const userId = `user_${crypto.randomUUID()}`;
    const { key, hash } = generateApiKey();
    db.createUser({
      id: userId,
      username,
      role: 'admin',
      email: req.body?.email || undefined,
      api_key_hash: hash
    });
    res.status(201).json({ id: userId, username, role: 'admin', apiKey: key });
  } finally {
    db.close();
  }
});

// API Routes
app.get('/api/me', requireAuth(), (req, res) => {
  const user = (req as RequestWithUser).user;
  res.json(user);
});

app.get('/api/pipelines', requireAuth(), (req, res) => {
  const db = createDatabase();
  try {
    res.json(db.listPipelines());
  } finally {
    db.close();
  }
});

app.get('/api/pipelines/schedules', requireAuth(), (req, res) => {
  res.json(pipelineScheduler.getStatus());
});

app.post('/api/pipelines', requireAuth(), (req, res) => {
  const { name, repoId, serverId, steps } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Pipeline name is required' });
    return;
  }

  const db = createDatabase();
  try {
    const id = `pipeline_${crypto.randomUUID()}`;

    db.createPipeline({
      id,
      name,
      repo_id: repoId,
      server_id: serverId,
      config_enc: JSON.stringify(Array.isArray(steps) ? steps : [])
    });

    res.status(201).json({ id, name, status: 'created' });
  } finally {
    db.close();
  }
});

app.post('/api/pipelines/:id/schedule', requireAuth(), (req, res) => {
  const { id } = req.params;
  const intervalMsRaw = Number(req.body?.intervalMs);
  const branch = req.body?.branch;
  const runImmediate = req.body?.runImmediate === true;

  if (!Number.isFinite(intervalMsRaw) || intervalMsRaw <= 0) {
    res.status(400).json({ error: 'intervalMs is required and must be greater than 0' });
    return;
  }

  try {
    const schedule = pipelineScheduler.schedule(id, intervalMsRaw, { branch, runImmediate });
    res.status(201).json(schedule);
  } catch (error) {
    if ((error as Error).message.includes('does not exist')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/pipelines/:id/schedule', requireAuth(), (req, res) => {
  const { id } = req.params;
  const removed = pipelineScheduler.unschedule(id);
  if (!removed) {
    res.status(404).json({ message: `No active schedule for pipeline ${id}` });
    return;
  }
  res.json({ id, status: 'unscheduled' });
});

app.put('/api/pipelines/:id', requireAuth(), (req, res) => {
  const { id } = req.params;
  const { name, repoId, serverId, steps } = req.body;
  const db = createDatabase();

  try {
    const existing = db.getPipeline(id);
    if (!existing) {
      res.status(404).json({ error: `Pipeline ${id} not found` });
      return;
    }

    if (!name && !repoId && !serverId && !Array.isArray(steps)) {
      res.status(400).json({ error: 'No update fields provided' });
      return;
    }

    const changes = db.updatePipeline(id, {
      name: name || undefined,
      repo_id: repoId,
      server_id: serverId,
      config_enc: Array.isArray(steps) ? JSON.stringify(steps) : undefined
    });

    if (changes === 0) {
      res.status(409).json({ error: `Pipeline ${id} was not updated` });
      return;
    }

    res.json({ id, status: 'updated', updatedFields: req.body });
  } finally {
    db.close();
  }
});

app.delete('/api/pipelines/:id', requireAuth(), (req, res) => {
  const { id } = req.params;
  const db = createDatabase();
  try {
    const changes = db.deletePipeline(id);
    if (changes === 0) {
      res.status(404).json({ error: `Pipeline ${id} not found` });
      return;
    }

    res.json({ id, status: 'deleted' });
  } finally {
    db.close();
  }
});

app.post('/api/pipelines/:id/run', requireAuth(), (req, res) => {
  const { id } = req.params;
  const { branch } = req.body || {};
  const user = (req as RequestWithUser).user;
  const db = createDatabase();
  const executor = new PipelineExecutor(db);

  try {
    const pipeline = db.getPipeline(id);
    if (!pipeline) {
      res.status(404).json({ error: `Pipeline ${id} not found` });
      db.close();
      return;
    }

    void executor.run(id, branch, user ? `api:${user.id}` : 'api').then((runId) => {
      res.status(201).json({ runId, status: 'running' });
    }).catch((error) => {
      res.status(500).json({ error: (error as Error).message });
    }).finally(() => {
      db.close();
    });
    return;
  } catch (error) {
    db.close();
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/runs/:runId/analyze', requireAuth(), async (req, res) => {
  const { runId } = req.params;
  const db = createDatabase();
  try {
    const run = db.getPipelineRun(runId);
    if (!run) {
      res.status(404).json({ error: `Run ${runId} not found` });
      return;
    }
    const analysis = await analyzeFailure(run);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  } finally {
    db.close();
  }
});

app.get('/api/dashboard/config', (_req, res) => {
  res.json({ pollIntervalMs: config.dashboardPollIntervalMs });
});

app.get('/api/servers/status', requireAuth(['admin']), (req, res) => {
  const db = createDatabase();
  try {
    res.json(db.getServersWithStatus());
  } finally {
    db.close();
  }
});

app.get('/api/servers', requireAuth(['admin']), (req, res) => {
  const db = createDatabase();
  try {
    const servers = db.listServers().map((s: any) => {
      const { credentials_enc, ...safe } = s;
      return safe;
    });
    res.json(servers);
  } finally {
    db.close();
  }
});

app.post('/api/servers', requireAuth(['admin']), (req, res) => {
  const { name, type, host, port, credentials } = req.body;
  if (!name || !type || !host || !credentials) {
    res.status(400).json({ error: 'name, type, host, credentials are required' });
    return;
  }

  const db = createDatabase();
  try {
    const id = `server_${crypto.randomUUID()}`;
    const credentialsEnc = encrypt(JSON.stringify(credentials), secret);

    db.createServer({
      id,
      name,
      type,
      host,
      port: typeof port === 'number' ? port : undefined,
      credentials_enc: credentialsEnc
    });

    res.status(201).json({ id, name, status: 'created' });
  } finally {
    db.close();
  }
});

app.get('/api/servers/:id', requireAuth(['admin']), (req, res) => {
  const db = createDatabase();
  try {
    const servers = db.listServers();
    const server = servers.find((s: any) => s.id === req.params.id);
    if (!server) {
      res.status(404).json({ error: `Server ${req.params.id} not found` });
      return;
    }
    const { credentials_enc, ...safe } = server;
    res.json(safe);
  } finally {
    db.close();
  }
});

app.post('/api/servers/:id/test', requireAuth(['admin']), async (req, res) => {
  try {
    const result = await remoteExecutor.testConnection(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/servers/:id', requireAuth(['admin']), (req, res) => {
  const db = createDatabase();
  try {
    const changes = db.deleteServer(req.params.id);
    if (changes === 0) {
      res.status(404).json({ error: `Server ${req.params.id} not found` });
      return;
    }
    res.json({ id: req.params.id, status: 'deleted' });
  } finally {
    db.close();
  }
});

app.get('/api/repos', requireAuth(['admin']), (req, res) => {
  const db = createDatabase();
  try {
    res.json(db.listGitRepos());
  } finally {
    db.close();
  }
});

app.post('/api/repos', requireAuth(['admin']), (req, res) => {
  const { name, platform, baseUrl, accessToken } = req.body;

  if (!name || !platform || !baseUrl || !accessToken) {
    res.status(400).json({ error: 'name, platform, baseUrl, accessToken are required' });
    return;
  }

  const db = createDatabase();
  try {
    const id = `repo_${crypto.randomUUID()}`;
    const accessTokenEnc = encrypt(accessToken, secret);

    db.createGitRepo({
      id,
      name,
      platform,
      base_url: baseUrl,
      access_token_enc: accessTokenEnc
    });

    res.status(201).json({ id, name, status: 'created' });
  } finally {
    db.close();
  }
});

app.get('/api/users', requireAuth(['admin']), (req, res) => {
  const db = createDatabase();
  try {
    res.json(db.listUsers());
  } finally {
    db.close();
  }
});

app.post('/api/users', requireAuth(['admin']), (req, res) => {
  const { username, role, email, git_name, git_email } = req.body;
  if (!username || !role) {
    res.status(400).json({ error: 'username and role are required' });
    return;
  }

  const db = createDatabase();
  try {
    const userId = `user_${crypto.randomUUID()}`;
    const { key, hash } = generateApiKey();

    db.createUser({
      id: userId,
      username,
      role,
      email,
      api_key_hash: hash,
      git_name: git_name || undefined,
      git_email: git_email || undefined,
    });

    res.status(201).json({ id: userId, username, role, email, git_name, git_email, apiKey: key });
  } finally {
    db.close();
  }
});

app.get('/api/runs/recent', requireAuth(), (req, res) => {
  const db = createDatabase();
  try {
    res.json(db.getRecentRuns());
  } finally {
    db.close();
  }
});

app.post('/api/tools/docker/scan', requireAuth(['admin', 'developer']), async (req, res) => {
  const { projectPath = '.' } = req.body || {};
  try {
    const normalized = path.resolve(String(projectPath));
    const report = await scanDockerProject(normalized);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/tools/skill/render', requireAuth(['admin', 'developer']), async (req, res) => {
  const {
    skillRoot = '/tmp',
    role,
    projectType,
    ruleFiles = [],
    context = {}
  } = req.body || {};

  try {
    const result = await buildSkillPrompt(skillRoot, {
      role,
      projectType,
      ruleFiles,
      context
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/metrics', requireAuth(['admin']), (req, res) => {
  const serverId = typeof req.query.serverId === 'string' ? req.query.serverId : undefined;
  const metricNames = typeof req.query.metricNames === 'string'
    ? req.query.metricNames.split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;
  const source = req.query.source === 'prometheus' ? 'prometheus'
    : req.query.source === 'internal' ? 'internal'
    : undefined;

  const db = createDatabase();
  try {
    res.json(db.getLatestMetrics({ serverId, metricNames, source }));
  } finally {
    db.close();
  }
});

app.get('/api/metrics/history', requireAuth(['admin']), (req, res) => {
  const parsedHours = req.query.hours ? parseInt(req.query.hours as string, 10) : 24;
  const hours = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 24;
  const serverId = typeof req.query.serverId === 'string' ? req.query.serverId : undefined;
  const metricNames = typeof req.query.metricNames === 'string'
    ? req.query.metricNames.split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;
  const source = req.query.source === 'prometheus' ? 'prometheus'
    : req.query.source === 'internal' ? 'internal'
    : undefined;
  const db = createDatabase();
  try {
    res.json(db.getMetricsHistory(hours, { serverId, metricNames, source }));
  } finally {
    db.close();
  }
});

app.get('/api/metrics/catalog', requireAuth(['admin']), (req, res) => {
  const serverId = typeof req.query.serverId === 'string' ? req.query.serverId : undefined;
  const db = createDatabase();
  try {
    const names = db.listMetricNames(serverId);
    res.json(names);
  } finally {
    db.close();
  }
});

app.post('/api/metrics/prometheus/import', requireAuth(['admin']), (req, res) => {
  const samples = Array.isArray(req.body?.samples) ? req.body.samples : [];
  const validMetricTypes = new Set(['gauge', 'counter', 'histogram', 'summary', 'untyped']);
  const db = createDatabase();
  let imported = 0;

  try {
    for (const sample of samples) {
      const metricName = typeof sample?.metric_name === 'string' ? sample.metric_name : '';
      const metricValue = Number(sample?.metric_value);
      const serverId = typeof sample?.server_id === 'string' ? sample.server_id : '';
      const metricTypeRaw = typeof sample?.metric_type === 'string' ? sample.metric_type : 'gauge';
      const metricType = validMetricTypes.has(metricTypeRaw)
        ? metricTypeRaw as 'gauge' | 'counter' | 'histogram' | 'summary' | 'untyped'
        : 'gauge';
      const labelsRaw = sample?.labels && typeof sample.labels === 'object'
        ? sample.labels as Record<string, unknown>
        : {};
      const labels = Object.fromEntries(
        Object.entries(labelsRaw).map(([key, value]) => [key, String(value)])
      );
      const collectedAt = Number(sample?.collected_at);

      if (!metricName || !serverId || !Number.isFinite(metricValue)) {
        continue;
      }

      db.saveMetric({
        server_id: serverId,
        metric_name: metricName,
        metric_value: metricValue,
        metric_type: metricType,
        labels,
        source: 'prometheus',
        collected_at: Number.isFinite(collectedAt) ? Math.floor(collectedAt) : undefined
      });
      imported += 1;
    }

    res.json({ status: 'success', imported });
  } finally {
    db.close();
  }
});

app.post('/api/metrics/collect', requireAuth(['admin']), async (req, res) => {
  try {
    await metricsCollector.collect();
    res.json({ status: 'success', message: 'Metrics collection triggered manually' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============ Light Auth: Git Identity ============
app.post('/api/auth/identify', (req, res) => {
  const { git_user_name, git_user_email } = req.body || {};
  if (!git_user_name || !git_user_email) {
    res.status(400).json({ error: 'git_user_name and git_user_email are required' });
    return;
  }

  const db = createDatabase();
  try {
    const user = db.getUserByGitIdentity(git_user_name, git_user_email);
    if (!user) {
      res.status(401).json({
        error: 'Unknown developer. Ask your admin to register your git identity.',
        git_user_name,
        git_user_email,
      });
      return;
    }

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      git_name: user.git_name,
      git_email: user.git_email,
    });
  } finally {
    db.close();
  }
});

// ============ Pipeline Trigger (from IDE Skill) ============
app.post('/api/trigger', async (req, res) => {
  const { git_user_name, git_user_email, repo_url, branch, commit_sha } = req.body || {};

  if (!git_user_name || !git_user_email) {
    res.status(400).json({ error: 'git_user_name and git_user_email are required' });
    return;
  }
  if (!repo_url || !branch) {
    res.status(400).json({ error: 'repo_url and branch are required' });
    return;
  }

  const db = createDatabase();
  try {
    const user = db.getUserByGitIdentity(git_user_name, git_user_email);
    if (!user) {
      res.status(401).json({ error: 'Unknown developer. Ask your admin to register your git identity.' });
      return;
    }

    const result = await remoteExecutor.trigger({
      repo_url,
      branch,
      commit_sha,
      triggered_by: `git:${user.id}`,
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  } finally {
    db.close();
  }
});

// ============ Pipeline Template Generation ============
app.post('/api/templates/pipeline-yaml', async (req, res) => {
  const { project_path = '.', name } = req.body || {};
  try {
    const result = await generatePipelineYaml(String(project_path), { name });
    res.json({
      yaml: result.yaml,
      project_type: result.projectType,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/runs/:runId/logs', requireAuth(), (req, res) => {
  const { runId } = req.params;
  const db = createDatabase();
  try {
    const run = db.getPipelineRun(runId);
    if (!run) {
      res.status(404).json({ error: `Run ${runId} not found` });
      return;
    }

    if (!run.log_path) {
      res.json({ logs: '' });
      return;
    }

    try {
      const fs = require('fs');
      const logs = fs.readFileSync(run.log_path, 'utf-8');
      res.json({ runId, logs, status: run.status });
    } catch {
      res.json({ runId, logs: '', status: run.status });
    }
  } finally {
    db.close();
  }
});

const port = config.port || 9800;

// Serve Web Dashboard in Production
const webDistPath = path.join(__dirname, '../../web/dist');
app.use(express.static(webDistPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(webDistPath, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Qunkins server running on 0.0.0.0:${port}`);
  console.log(`  Health: http://0.0.0.0:${port}/health`);
  console.log(`  API:    http://0.0.0.0:${port}/api/*`);
});
