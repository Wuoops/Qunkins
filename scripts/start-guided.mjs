#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dockerDir = path.join(rootDir, 'docker');
const localDir = path.join(rootDir, '.local');
const configPath = path.join(localDir, 'config.json');
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');
const defaultBaseUrl = process.env.QUNKINS_BASE_URL || 'http://localhost:9800';

function printStep(title) {
  console.log(`\n=== ${title} ===`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatEnvValue(value) {
  if (value === '') {
    return '';
  }
  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function readJsonFile(filePath, fallback) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

function updateEnvValue(envText, key, value) {
  const line = `${key}=${formatEnvValue(value)}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
  if (pattern.test(envText)) {
    return envText.replace(pattern, line);
  }
  return `${envText.trimEnd()}\n${line}\n`;
}

function ensureEnvContent() {
  if (fs.existsSync(envPath)) {
    return fs.readFileSync(envPath, 'utf8');
  }
  if (fs.existsSync(envExamplePath)) {
    return fs.readFileSync(envExamplePath, 'utf8');
  }
  return '';
}

function parseEnvValue(envText, key) {
  const pattern = new RegExp(`^${escapeRegExp(key)}=(.*)$`, 'm');
  const match = envText.match(pattern);
  if (!match) return '';
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      stdio: options.stdio || 'inherit',
      env: process.env
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code ?? 'unknown'})`));
    });
  });
}

function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `Command failed: ${command} ${args.join(' ')}`));
    });
  });
}

async function ask(rl, label, defaultValue = '') {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function askRequired(rl, label, defaultValue = '') {
  while (true) {
    const value = await ask(rl, label, defaultValue);
    if (value) return value;
    console.log('该项不能为空，请重新输入。');
  }
}

async function askYesNo(rl, label, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  while (true) {
    const answer = (await rl.question(`${label} ${suffix}: `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) return false;
    console.log('请输入 y 或 n。');
  }
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function waitForHealth(baseUrl, timeoutMs = 120000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting
    }
    await sleep(2000);
  }
  throw new Error(`等待健康检查超时: ${baseUrl}/health`);
}

async function verifyApiKey(baseUrl, apiKey) {
  if (!apiKey) return false;
  try {
    const response = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

function generateRandomToken(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function collectNodes(rl, existingNodes) {
  const nodes = [];
  const shouldCollect = await askYesNo(
    rl,
    'Step 1/5 - 启动前是否需要先录入执行节点',
    existingNodes.length === 0
  );
  if (!shouldCollect) return nodes;

  let index = 1;
  while (true) {
    console.log(`\n录入第 ${index} 个节点:`);
    const name = await askRequired(rl, '节点名称');
    const typeRaw = (await ask(rl, '节点类型 (ssh/k8s)', 'ssh')).toLowerCase();
    const type = typeRaw === 'k8s' ? 'k8s' : 'ssh';
    const host = await askRequired(rl, '主机地址');
    const defaultPort = type === 'ssh' ? '22' : '6443';
    const portRaw = await ask(rl, '端口', defaultPort);
    const port = Number.isFinite(Number(portRaw)) ? Number(portRaw) : Number(defaultPort);

    let credentials;
    if (type === 'ssh') {
      const username = await askRequired(rl, 'SSH 用户名', 'root');
      const password = await askRequired(rl, 'SSH 密码');
      credentials = { username, password };
    } else {
      const kubeConfig = await askRequired(rl, 'K8s 凭据 (kubeconfig/token 单行文本)');
      credentials = { kubeConfig };
    }

    nodes.push({ name, type, host, port, credentials });

    const more = await askYesNo(rl, '继续添加节点吗', false);
    if (!more) break;
    index += 1;
  }

  return nodes;
}

async function collectDevelopers(rl, baseUrl, apiKey) {
  const shouldCollect = await askYesNo(
    rl,
    'Step 2/5 - 是否录入团队开发者的 Git 身份（用于轻鉴权）',
    true
  );
  if (!shouldCollect) return [];

  const developers = [];
  let index = 1;
  while (true) {
    console.log(`\n录入第 ${index} 个开发者:`);
    const username = await askRequired(rl, '用户名');
    const gitName = await askRequired(rl, 'Git user.name（开发者机器上 git config user.name 的值）');
    const gitEmail = await askRequired(rl, 'Git user.email');
    const email = await ask(rl, '邮箱（可选，用于通知）', gitEmail);

    developers.push({ username, git_name: gitName, git_email: gitEmail, email, role: 'developer' });

    const more = await askYesNo(rl, '继续添加开发者吗', false);
    if (!more) break;
    index += 1;
  }

  return developers;
}

async function registerDevelopers(baseUrl, apiKey, developers) {
  const results = [];
  for (const dev of developers) {
    try {
      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dev)
      });
      const payload = await safeJson(response);
      if (response.ok) {
        results.push({ ...dev, id: payload.id, apiKey: payload.apiKey, ok: true });
      } else {
        results.push({ ...dev, ok: false, error: payload.error || response.statusText });
      }
    } catch (error) {
      results.push({ ...dev, ok: false, error: error.message });
    }
  }
  return results;
}

function generateAgentsMd() {
  const skillsPath = path.join(rootDir, 'packages', 'skills', 'developer', 'AGENTS.md');
  try {
    return fs.readFileSync(skillsPath, 'utf8');
  } catch {
    return `# Qunkins Developer Skill\n\nPlease install the full AGENTS.md template from Qunkins.\n`;
  }
}

async function collectModels(rl, existingModels) {
  const models = [];
  const shouldCollect = await askYesNo(
    rl,
    'Step 2/5 - 是否配置模型连接信息（用于后续接入）',
    existingModels.length === 0
  );
  if (!shouldCollect) return existingModels;

  let index = 1;
  while (true) {
    console.log(`\n录入第 ${index} 个模型连接:`);
    const provider = await askRequired(rl, 'Provider (openai/anthropic/google/ollama/custom)', 'openai');
    const model = await askRequired(rl, '模型标识 (例如 gpt-4o-mini)');
    const baseUrl = await ask(rl, 'API Base URL (可留空)');
    const apiKeyEnv = await ask(rl, 'API Key 环境变量名 (例如 OPENAI_API_KEY)', '');

    models.push({
      id: `model_${index}`,
      provider,
      model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKeyEnv ? { apiKeyEnv } : {})
    });

    const more = await askYesNo(rl, '继续添加模型连接吗', false);
    if (!more) break;
    index += 1;
  }

  return models;
}

async function collectFeishu(rl, existingFeishu) {
  const shouldCollect = await askYesNo(
    rl,
    'Step 3/5 - 是否配置飞书连接信息',
    true
  );
  if (!shouldCollect) {
    return existingFeishu;
  }

  const appId = await askRequired(rl, 'FEISHU_APP_ID', existingFeishu.appId || 'cli_xxxxxxxxxxxxxxxx');
  const appSecret = await askRequired(rl, 'FEISHU_APP_SECRET', existingFeishu.appSecret || '');
  return { appId, appSecret };
}

function getDefaultConfig() {
  return {
    version: 1,
    profile: 'default',
    server: {
      baseUrl: defaultBaseUrl
    },
    auth: {
      bootstrapUsername: 'admin',
      apiKey: ''
    },
    feishu: {
      appId: '',
      appSecret: ''
    },
    models: [],
    nodes: [],
    onboarding: {
      pendingNodes: [],
      lastRunAt: ''
    }
  };
}

async function bootstrapAdminIfNeeded(baseUrl, bootstrapKey, username, existingApiKey, rl) {
  if (await verifyApiKey(baseUrl, existingApiKey)) {
    return existingApiKey;
  }

  const response = await fetch(`${baseUrl}/api/bootstrap/admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bootstrapKey,
      username
    })
  });

  if (response.status === 201) {
    const data = await safeJson(response);
    return data.apiKey || '';
  }

  if (response.status === 409) {
    console.log('\n检测到系统已有管理员用户，不能再次 bootstrap。');
    while (true) {
      const apiKey = await askRequired(rl, '请输入现有管理员 API Key');
      if (await verifyApiKey(baseUrl, apiKey)) {
        return apiKey;
      }
      console.log('API Key 无效，请重试。');
    }
  }

  const errorPayload = await safeJson(response);
  const message = errorPayload.error || errorPayload.raw || response.statusText;
  throw new Error(`管理员初始化失败: ${message}`);
}

async function createServers(baseUrl, apiKey, nodes) {
  const created = [];
  const failed = [];

  for (const node of nodes) {
    const response = await fetch(`${baseUrl}/api/servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(node)
    });

    if (response.ok) {
      const payload = await safeJson(response);
      created.push({
        id: payload.id || '',
        ...node
      });
      continue;
    }

    const payload = await safeJson(response);
    failed.push({
      ...node,
      error: payload.error || payload.raw || response.statusText
    });
  }

  return { created, failed };
}

async function ensureDockerComposeReady() {
  await runCommandCapture('docker', ['compose', 'version']);
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log('Qunkins Guided Start Wizard');

    await ensureDockerComposeReady();

    const existingConfig = readJsonFile(configPath, getDefaultConfig());
    const existingEnvText = ensureEnvContent();

    const pendingNodes = await collectNodes(rl, existingConfig.nodes || []);
    const pendingDevelopers = await collectDevelopers(rl, defaultBaseUrl, '');
    const models = await collectModels(rl, existingConfig.models || []);
    const feishu = await collectFeishu(rl, existingConfig.feishu || { appId: '', appSecret: '' });

    printStep('Step 4/5 - 生成/更新环境变量');
    const defaultSecret = parseEnvValue(existingEnvText, 'QUNKINS_SECRET') || generateRandomToken(24);
    const defaultBootstrapKey = parseEnvValue(existingEnvText, 'QUNKINS_BOOTSTRAP_KEY') || generateRandomToken(16);
    const defaultUsername = existingConfig.auth?.bootstrapUsername || 'admin';

    const qunkinsSecret = await askRequired(rl, 'QUNKINS_SECRET (建议 >= 32 字符)', defaultSecret);
    const bootstrapKey = await askRequired(rl, 'QUNKINS_BOOTSTRAP_KEY', defaultBootstrapKey);
    const bootstrapUsername = await askRequired(rl, '管理员用户名', defaultUsername);
    const buildBeforeStart = await askYesNo(rl, '启动时是否重新构建镜像 (--build)', true);

    let envText = existingEnvText || '';
    envText = updateEnvValue(envText, 'QUNKINS_SECRET', qunkinsSecret);
    envText = updateEnvValue(envText, 'QUNKINS_BOOTSTRAP_KEY', bootstrapKey);
    envText = updateEnvValue(envText, 'QUNKINS_AUTH_ENABLED', 'true');
    envText = updateEnvValue(envText, 'FEISHU_APP_ID', feishu.appId || '');
    envText = updateEnvValue(envText, 'FEISHU_APP_SECRET', feishu.appSecret || '');
    fs.writeFileSync(envPath, envText, 'utf8');
    console.log(`已写入 ${path.relative(rootDir, envPath)}`);

    const nextConfig = {
      ...getDefaultConfig(),
      ...existingConfig,
      server: {
        ...(existingConfig.server || {}),
        baseUrl: defaultBaseUrl
      },
      auth: {
        ...(existingConfig.auth || {}),
        bootstrapUsername
      },
      feishu,
      models,
      onboarding: {
        ...(existingConfig.onboarding || {}),
        pendingNodes,
        lastRunAt: new Date().toISOString()
      }
    };
    writeJsonFile(configPath, nextConfig);
    console.log(`已写入 ${path.relative(rootDir, configPath)}`);

    printStep('Step 5/5 - 启动服务并完成引导');
    const composeArgs = buildBeforeStart
      ? ['compose', 'up', '--build', '-d']
      : ['compose', 'up', '-d'];
    await runCommand('docker', composeArgs, { cwd: dockerDir, stdio: 'inherit' });

    console.log('\n等待服务健康检查...');
    await waitForHealth(defaultBaseUrl, 120000);
    console.log('服务已就绪。');

    const existingApiKey = existingConfig.auth?.apiKey || '';
    const apiKey = await bootstrapAdminIfNeeded(
      defaultBaseUrl,
      bootstrapKey,
      bootstrapUsername,
      existingApiKey,
      rl
    );

    if (!apiKey) {
      throw new Error('未能获取管理员 API Key，请检查 bootstrap 配置。');
    }

    console.log('\n管理员 API Key:');
    console.log(apiKey);

    const { created, failed } = await createServers(defaultBaseUrl, apiKey, pendingNodes);
    if (created.length > 0) {
      console.log(`\n已创建 ${created.length} 个节点:`);
      for (const item of created) {
        console.log(`- ${item.name} (${item.host}) id=${item.id}`);
      }
    }
    if (failed.length > 0) {
      console.log(`\n有 ${failed.length} 个节点创建失败，保留在 pendingNodes 中。`);
      for (const item of failed) {
        console.log(`- ${item.name} (${item.host}): ${item.error}`);
      }
    }

    const mergedNodes = [...(existingConfig.nodes || []), ...created];

    if (pendingDevelopers.length > 0) {
      console.log('\n正在注册团队开发者...');
      const devResults = await registerDevelopers(defaultBaseUrl, apiKey, pendingDevelopers);
      for (const dev of devResults) {
        if (dev.ok) {
          console.log(`- ${dev.username} (${dev.git_name} <${dev.git_email}>): 注册成功`);
        } else {
          console.log(`- ${dev.username}: 注册失败 - ${dev.error}`);
        }
      }
    }

    printStep('生成 AGENTS.md 模板');
    const agentsMdContent = generateAgentsMd();
    const agentsMdOutputPath = path.join(localDir, 'AGENTS.md');
    fs.mkdirSync(path.dirname(agentsMdOutputPath), { recursive: true });
    fs.writeFileSync(agentsMdOutputPath, agentsMdContent, 'utf8');
    console.log(`AGENTS.md 模板已生成: ${path.relative(rootDir, agentsMdOutputPath)}`);
    console.log('请将此文件复制到各项目仓库的根目录，IDE 会自动加载。');

    writeJsonFile(configPath, {
      ...nextConfig,
      auth: {
        ...(nextConfig.auth || {}),
        apiKey
      },
      nodes: mergedNodes,
      onboarding: {
        ...(nextConfig.onboarding || {}),
        pendingNodes: failed
      }
    });

    console.log('\n引导完成。');
    console.log(`- Dashboard: ${defaultBaseUrl}`);
    console.log(`- API 健康检查: ${defaultBaseUrl}/health`);
    console.log('- 你可以用上面的 API Key 直接调用 /api/* 接口');
    console.log('\n运维 Checklist:');
    console.log('  1. 将 .local/AGENTS.md 复制到各项目仓库根目录');
    console.log('  2. 确保团队成员的 IDE 支持 AGENTS.md（Cursor/Claude Code/Copilot 均原生支持）');
    console.log('  3. 执行节点需要安装 Docker + Git');
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('\n启动失败:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
