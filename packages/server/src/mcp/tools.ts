import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Database, PipelineScheduler, analyzeFailure, RemoteExecutor, scanDockerProject, generatePipelineYaml } from '@qunkins/core';
import { PipelineExecutor } from '@qunkins/core/pipeline/executor';
import { FeishuWebhook } from '../webhook/feishu';
import crypto from 'crypto';
import path from 'path';

// Singleton instances
let dbInstance: Database | undefined;
let executorInstance: PipelineExecutor | undefined;
let schedulerInstance: PipelineScheduler | undefined;

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

let remoteExecutorInstance: RemoteExecutor | undefined;

function getScheduler(): PipelineScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new PipelineScheduler(getDb());
  }
  return schedulerInstance;
}

function getRemoteExecutor(): RemoteExecutor {
  if (!remoteExecutorInstance) {
    remoteExecutorInstance = new RemoteExecutor(
      getDb(),
      process.env.QUNKINS_SECRET || 'default-secret',
      process.env.QUNKINS_LOG_DIR || './logs'
    );
  }
  return remoteExecutorInstance;
}

export function registerTools(server: Server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'pipeline_trigger',
          description: 'Trigger a pipeline run from a Git repository. The server will clone the repo, read .qunkins/pipeline.yaml, and execute it on a remote node.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              git_user_name: { type: 'string', description: 'Git user.name of the developer' },
              git_user_email: { type: 'string', description: 'Git user.email of the developer' },
              repo_url: { type: 'string', description: 'Git remote URL' },
              branch: { type: 'string', description: 'Branch to build' },
              commit_sha: { type: 'string', description: 'Current HEAD commit SHA' },
            },
            required: ['git_user_name', 'git_user_email', 'repo_url', 'branch'],
          },
        },
        {
          name: 'pipeline_check',
          description: 'Check if a project directory has a valid Dockerfile and .qunkins/pipeline.yaml for CI readiness.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              project_path: { type: 'string', description: 'Absolute path to the project directory' },
            },
            required: ['project_path'],
          },
        },
        {
          name: 'pipeline_generate',
          description: 'Generate a .qunkins/pipeline.yaml template based on project type detection.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              project_path: { type: 'string', description: 'Absolute path to the project directory' },
              name: { type: 'string', description: 'Pipeline name (defaults to project directory name)' },
            },
            required: ['project_path'],
          },
        },
        {
          name: 'server_list',
          description: 'List all registered execution nodes (servers).',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'server_add',
          description: 'Add a new SSH execution node.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              name: { type: 'string', description: 'Node display name' },
              host: { type: 'string', description: 'SSH host/IP' },
              port: { type: 'number', description: 'SSH port (default 22)' },
              username: { type: 'string', description: 'SSH username' },
              password: { type: 'string', description: 'SSH password (or use privateKey)' },
              privateKey: { type: 'string', description: 'SSH private key content' },
            },
            required: ['name', 'host', 'username'],
          },
        },
        {
          name: 'server_test',
          description: 'Test SSH connectivity to an execution node. Returns OS info and Docker version.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              serverId: { type: 'string', description: 'Server ID to test' },
            },
            required: ['serverId'],
          },
        },
        {
          name: 'server_delete',
          description: 'Remove an execution node.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              serverId: { type: 'string', description: 'Server ID to delete' },
            },
            required: ['serverId'],
          },
        },
        {
          name: 'pipeline_create',
          description: 'Create a new pipeline configuration in the Qunkins database.',
          inputSchema: { type: 'object' as const, properties: { name: { type: 'string' }, config: { type: 'object' } }, required: ['name'] },
        },
        {
          name: 'pipeline_run',
          description: 'Trigger a registered pipeline by its ID.',
          inputSchema: { type: 'object' as const, properties: { pipelineId: { type: 'string' }, branch: { type: 'string' } }, required: ['pipelineId'] },
        },
        {
          name: 'pipeline_status',
          description: 'Get the status of a pipeline run.',
          inputSchema: { type: 'object' as const, properties: { runId: { type: 'string' } }, required: ['runId'] },
        },
        {
          name: 'pipeline_logs',
          description: 'Get logs of a pipeline run.',
          inputSchema: { type: 'object' as const, properties: { runId: { type: 'string' } }, required: ['runId'] },
        },
        {
          name: 'run_analyze',
          description: 'Analyze a failed pipeline run.',
          inputSchema: { type: 'object' as const, properties: { runId: { type: 'string' } }, required: ['runId'] },
        },
        {
          name: 'repo_add',
          description: 'Add a Git repository.',
          inputSchema: { type: 'object' as const, properties: { name: { type: 'string' }, platform: { type: 'string' }, baseUrl: { type: 'string' }, accessToken: { type: 'string' } }, required: ['name', 'platform', 'baseUrl', 'accessToken'] },
        },
        {
          name: 'repo_list',
          description: 'List all registered Git repositories.',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const db = getDb();
    const exec = getExecutor();

    try {
      switch (name) {
        // New MVP tools
        case 'pipeline_trigger':
          return await handlePipelineTrigger(args, db);
        case 'pipeline_check':
          return await handlePipelineCheck(args);
        case 'pipeline_generate':
          return await handlePipelineGenerate(args);

        // Server Tools
        case 'server_list':
          return await handleServerList(db);
        case 'server_add':
          return await handleServerAdd(args, db);
        case 'server_test':
          return await handleServerTest(args);
        case 'server_delete':
          return await handleServerDelete(args, db);

        // Pipeline Tools
        case 'pipeline_create':
          return await handlePipelineCreate(args, db);
        case 'pipeline_run':
          return await handlePipelineRun(args, db, exec);
        case 'pipeline_status':
          return await handlePipelineStatus(args, db);
        case 'pipeline_logs':
          return await handlePipelineLogs(args, db);
        case 'pipeline_schedule':
          return await handlePipelineSchedule(args, getScheduler());
        case 'pipeline_unschedule':
          return await handlePipelineUnschedule(args, getScheduler());
        case 'pipeline_schedules':
          return await handlePipelineSchedules(getScheduler());
        case 'run_analyze':
          return await handleRunAnalyze(args, db);

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
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true
      };
    }
  });
}

async function handlePipelineCreate(args: any, db: Database) {
  const { name, config } = args;
  const id = `pipeline_${crypto.randomUUID()}`;
  
  db.createPipeline({
    id,
    name,
    repo_id: config?.repoId,
    server_id: config?.serverId,
    config_enc: JSON.stringify(config?.steps || [])
  });

  return { content: [{ type: 'text', text: `Pipeline "${name}" created with ID: ${id}` }] };
}

async function handlePipelineRun(args: any, _db: Database, executor: PipelineExecutor) {
  const { pipelineId, branch } = args;
  
  const runId = await executor.run(pipelineId, branch);
  
  return { content: [{ type: 'text', text: `Pipeline triggered. Run ID: ${runId}` }] };
}

async function handlePipelineSchedule(args: any, scheduler: PipelineScheduler) {
  const { pipelineId, intervalMs, branch, runImmediate } = args;
  const parsedInterval = Number(intervalMs);

  if (!pipelineId) {
    return { content: [{ type: 'text', text: 'pipelineId is required' }], isError: true };
  }
  if (!Number.isFinite(parsedInterval) || parsedInterval <= 0) {
    return { content: [{ type: 'text', text: 'intervalMs must be a number greater than 0' }], isError: true };
  }

  try {
    const schedule = scheduler.schedule(pipelineId, parsedInterval, {
      branch,
      runImmediate
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(schedule, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to create schedule: ${(error as Error).message}` }],
      isError: true
    };
  }
}

async function handlePipelineUnschedule(args: any, scheduler: PipelineScheduler) {
  const { pipelineId } = args;
  if (!pipelineId) {
    return { content: [{ type: 'text', text: 'pipelineId is required' }], isError: true };
  }

  const removed = scheduler.unschedule(pipelineId);
  if (!removed) {
    return {
      content: [{ type: 'text', text: `No active schedule found for ${pipelineId}` }],
      isError: true
    };
  }

  return { content: [{ type: 'text', text: `Pipeline ${pipelineId} unscheduled` }] };
}

async function handlePipelineSchedules(scheduler: PipelineScheduler) {
  return { content: [{ type: 'text', text: JSON.stringify(scheduler.getStatus(), null, 2) }] };
}

async function handleRunAnalyze(args: any, db: Database) {
  const { runId } = args;
  if (!runId) {
    return { content: [{ type: 'text', text: 'runId is required' }], isError: true };
  }

  const run = db.getPipelineRun(runId);
  if (!run) {
    return { content: [{ type: 'text', text: `Run ${runId} not found` }], isError: true };
  }

  const analysis = await analyzeFailure(run);
  return { content: [{ type: 'text', text: JSON.stringify(analysis, null, 2) }] };
}

async function handlePipelineStatus(args: any, db: Database) {
  const { runId } = args;
  const run = db.getPipelineRun(runId);
  
  if (!run) {
    return { content: [{ type: 'text', text: `Run ${runId} not found` }], isError: true };
  }
  
  return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
}

async function handlePipelineLogs(args: any, db: Database) {
  const { runId } = args;
  const run = db.getPipelineRun(runId);
  
  if (!run?.log_path) {
    return { content: [{ type: 'text', text: 'No logs available for this run' }] };
  }
  
  try {
    const fs = await import('fs');
    const logs = fs.readFileSync(run.log_path, 'utf-8');
    return { content: [{ type: 'text', text: logs }] };
  } catch {
    return { content: [{ type: 'text', text: 'Failed to read log file' }], isError: true };
  }
}

async function handleRepoAdd(args: any, db: Database) {
  const { name, platform, baseUrl, accessToken } = args;
  const { encrypt } = await import('@qunkins/core/crypto/aes');
  
  const id = `repo_${crypto.randomUUID()}`;
  const encryptedToken = encrypt(accessToken, process.env.QUNKINS_SECRET || 'default-secret');
  
  db.createGitRepo({
    id,
    name,
    platform,
    base_url: baseUrl,
    access_token_enc: encryptedToken
  });

  return { content: [{ type: 'text', text: `Repository "${name}" added successfully` }] };
}

async function handleRepoList(db: Database) {
  const repos = db.listGitRepos();
  return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
}

async function handleRulesSync(args: any, db: Database) {
  const { repoId, rulesPath } = args;
  if (!repoId || !rulesPath) {
    return { content: [{ type: 'text', text: 'repoId and rulesPath are required' }], isError: true };
  }

  const repo = db.listGitRepos().find((item: { id: string }) => item.id === repoId);
  if (!repo) {
    return { content: [{ type: 'text', text: `Repository ${repoId} not found` }], isError: true };
  }

  try {
    const fs = await import('fs/promises');
    const raw = await fs.readFile(rulesPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const versionId = `rule_${crypto.randomUUID()}`;
    db.createRuleVersion({
      id: versionId,
      repo_id: repoId,
      file_path: rulesPath,
      content_hash: hash
    });

    return {
      content: [{
        type: 'text',
        text: `Rules synced for repo ${repo.name} (${repoId}), version ${versionId}, hash=${hash}`
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to sync rules file: ${(error as Error).message}` }],
      isError: true
    };
  }
}

async function handleUserCreate(args: any, db: Database) {
  const { username, role, email } = args;
  const apiKey = `qk_${crypto.randomBytes(16).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const id = `user_${crypto.randomUUID()}`;
  db.createUser({ id, username, role, email, api_key_hash: apiKeyHash });

  return { content: [{ type: 'text', text: `User created.\nAPI Key: ${apiKey}\n(User ID: ${id})` }] };
}

async function handleNotifyTest(args: any, _db: Database) {
  const { type = 'feishu', chatId, message } = args;

  if (type !== 'feishu') {
    return { content: [{ type: 'text', text: `Unsupported notification type: ${type}` }], isError: true };
  }

  if (!chatId) {
    return { content: [{ type: 'text', text: 'chatId is required for notify_test' }], isError: true };
  }

  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    return {
      content: [{ type: 'text', text: 'FEISHU_APP_ID and FEISHU_APP_SECRET are required for notification test' }],
      isError: true
    };
  }

  try {
    const webhook = new FeishuWebhook({
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET
    });
    await webhook.sendMessage(chatId, message || 'Qunkins notification test message');
    return { content: [{ type: 'text', text: `Test notification sent via ${type} to ${chatId}` }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Failed to send notification: ${(error as Error).message}` }], isError: true };
  }
}

async function handleRulesQuery(args: any, db: Database) {
  const { repoId, topic, limit } = args;
  const records = db.listRuleVersions(repoId, topic);

  if (records.length === 0) {
    return { content: [{ type: 'text', text: `No rules found for repo=${repoId ?? 'all'} topic=${topic ?? 'all'}` }] };
  }

  const rawLimit = Number(limit);
  const take = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.trunc(rawLimit || 10))) : 10;
  const sorted = records.slice(0, take);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        topic: topic || 'all',
        repoId: repoId || 'all',
        items: sorted
      }, null, 2)
    }]
  };
}

// ============ Server Handlers ============

async function handleServerList(db: Database) {
  const servers = db.listServers();
  const safeServers = servers.map((s: any) => {
    const { credentials_enc, ...rest } = s;
    return rest;
  });
  return {
    content: [{
      type: 'text',
      text: safeServers.length > 0
        ? JSON.stringify(safeServers, null, 2)
        : 'No execution nodes registered. Use server_add to add one.',
    }],
  };
}

async function handleServerAdd(args: any, db: Database) {
  const { name, host, port, username, password, privateKey } = args;
  if (!name || !host || !username) {
    return { content: [{ type: 'text', text: 'name, host, and username are required' }], isError: true };
  }

  const { encrypt } = await import('@qunkins/core/crypto/aes');
  const id = `server_${crypto.randomUUID()}`;
  const credentials: any = { username };
  if (privateKey) {
    credentials.privateKey = privateKey;
  } else if (password) {
    credentials.password = password;
  }

  const credentialsEnc = encrypt(JSON.stringify(credentials), process.env.QUNKINS_SECRET || 'default-secret');

  db.createServer({
    id,
    name,
    type: 'ssh',
    host,
    port: port || 22,
    credentials_enc: credentialsEnc,
  });

  return {
    content: [{ type: 'text', text: `Execution node "${name}" (${host}) added. ID: ${id}` }],
  };
}

async function handleServerTest(args: any) {
  const { serverId } = args;
  if (!serverId) {
    return { content: [{ type: 'text', text: 'serverId is required' }], isError: true };
  }

  const executor = getRemoteExecutor();
  const result = await executor.testConnection(serverId);

  return {
    content: [{
      type: 'text',
      text: result.ok
        ? `Node "${result.server}" (${result.host}) is reachable.\n\n${result.detail}`
        : `Node "${result.server}" (${result.host}) is NOT reachable.\n\nError: ${result.detail}`,
    }],
    isError: !result.ok,
  };
}

async function handleServerDelete(args: any, db: Database) {
  const { serverId } = args;
  if (!serverId) {
    return { content: [{ type: 'text', text: 'serverId is required' }], isError: true };
  }

  const changes = db.deleteServer(serverId);
  if (changes === 0) {
    return { content: [{ type: 'text', text: `Server ${serverId} not found` }], isError: true };
  }
  return { content: [{ type: 'text', text: `Server ${serverId} deleted.` }] };
}

// ============ New MVP Handlers ============

async function handlePipelineTrigger(args: any, db: Database) {
  const { git_user_name, git_user_email, repo_url, branch, commit_sha } = args;

  if (!git_user_name || !git_user_email) {
    return { content: [{ type: 'text', text: 'git_user_name and git_user_email are required' }], isError: true };
  }
  if (!repo_url || !branch) {
    return { content: [{ type: 'text', text: 'repo_url and branch are required' }], isError: true };
  }

  const user = db.getUserByGitIdentity(git_user_name, git_user_email);
  if (!user) {
    return {
      content: [{
        type: 'text',
        text: `Unknown developer (${git_user_name} <${git_user_email}>). Ask your admin to register your git identity in Qunkins.`
      }],
      isError: true,
    };
  }

  try {
    const executor = getRemoteExecutor();
    const result = await executor.trigger({
      repo_url,
      branch,
      commit_sha,
      triggered_by: `git:${user.id}`,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: result.status === 'success'
            ? `Pipeline completed successfully. Run ID: ${result.runId}`
            : `Pipeline failed. Run ID: ${result.runId}. Error: ${result.error}`,
          ...result,
        }, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to trigger pipeline: ${(error as Error).message}` }],
      isError: true,
    };
  }
}

async function handlePipelineCheck(args: any) {
  const { project_path } = args;
  if (!project_path) {
    return { content: [{ type: 'text', text: 'project_path is required' }], isError: true };
  }

  const fs = await import('fs/promises');
  const checks: { item: string; ok: boolean; detail: string }[] = [];

  // Check Dockerfile
  const dockerReport = await scanDockerProject(project_path);
  checks.push({
    item: 'Dockerfile',
    ok: dockerReport.dockerfile.exists,
    detail: dockerReport.dockerfile.exists
      ? `Found at ${dockerReport.dockerfile.filePath} (score: ${dockerReport.dockerfile.score}/100)`
      : 'Not found. A Dockerfile is required for CI.',
  });

  if (dockerReport.dockerfile.exists && dockerReport.dockerfile.issues.length > 0) {
    for (const issue of dockerReport.dockerfile.issues) {
      checks.push({
        item: `Dockerfile: ${issue.severity}`,
        ok: issue.severity !== 'error',
        detail: `${issue.message} — ${issue.suggestion}`,
      });
    }
  }

  // Check pipeline.yaml
  const pipelinePath = path.join(project_path, '.qunkins', 'pipeline.yaml');
  let pipelineExists = false;
  try {
    await fs.access(pipelinePath);
    pipelineExists = true;
  } catch {
    // not found
  }

  checks.push({
    item: '.qunkins/pipeline.yaml',
    ok: pipelineExists,
    detail: pipelineExists
      ? `Found at ${pipelinePath}`
      : 'Not found. A pipeline.yaml is required to run CI.',
  });

  const allOk = checks.every((c) => c.ok);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ci_ready: allOk,
        checks,
        summary: allOk
          ? 'Project is CI-ready.'
          : 'Project is NOT CI-ready. See checks above for details.',
      }, null, 2),
    }],
  };
}

async function handlePipelineGenerate(args: any) {
  const { project_path, name } = args;
  if (!project_path) {
    return { content: [{ type: 'text', text: 'project_path is required' }], isError: true };
  }

  try {
    const result = await generatePipelineYaml(project_path, { name });
    return {
      content: [{
        type: 'text',
        text: `Generated pipeline.yaml for ${result.projectType} project:\n\n${result.yaml}`,
      }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to generate pipeline.yaml: ${(error as Error).message}` }],
      isError: true,
    };
  }
}
