import fs from 'fs/promises';
import path from 'path';

export interface DockerValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  suggestion: string;
}

export interface DockerFileReport {
  filePath: string;
  exists: boolean;
  issues: DockerValidationIssue[];
  score: number;
}

export interface DockerProjectReport {
  projectPath: string;
  dockerfile: DockerFileReport;
  composeFile?: DockerFileReport;
  hasArtifacts: boolean;
}

function createIssue(
  severity: 'error' | 'warning',
  message: string,
  suggestion: string
): DockerValidationIssue {
  return { severity, message, suggestion };
}

function normalizeScore(issues: DockerValidationIssue[]): number {
  if (issues.some((item) => item.severity === 'error')) {
    return 0;
  }

  const warnCount = issues.filter((item) => item.severity === 'warning').length;
  return Math.max(0, 100 - warnCount * 10);
}

function validateDockerfileContent(content: string): DockerValidationIssue[] {
  const lines = content.split('\n');
  const issues: DockerValidationIssue[] = [];

  if (!/^FROM\s+/m.test(content)) {
    issues.push(createIssue('error', '缺少 FROM 指令', '请添加基础镜像声明（如 FROM node:20-alpine）'));
  }

  if (!/WORKDIR\s+/m.test(content)) {
    issues.push(createIssue('warning', '未设置 WORKDIR', '建议添加 WORKDIR，提升路径稳定性'));
  }

  if (!/COPY\s+.*\s+\/app|WORKDIR\s+\/app|RUN\s+.*\.{1,2}/m.test(content)) {
    issues.push(createIssue('warning', '文件上下文使用不规范', '建议优先使用显式路径复制并确认上下文路径存在'));
  }

  if (!/HEALTHCHECK\s+/m.test(content)) {
    issues.push(createIssue('warning', '未发现 HEALTHCHECK', '建议添加健康检查，便于编排系统判断服务健康'));
  }

  if (/\bADD\b/.test(content)) {
    issues.push(createIssue('warning', '推荐使用 COPY 替代 ADD', 'COPY 更明确且更易审计'));
  }

  if (lines.some((line) => line.trim().startsWith('RUN') && line.includes('npm install') && !line.includes('--no-audit'))) {
    issues.push(createIssue('warning', 'npm 安装未加速率控制', '建议使用 --prefer-offline 或先做依赖缓存再安装'));
  }

  return issues;
}

function validateComposeContent(content: string): DockerValidationIssue[] {
  const issues: DockerValidationIssue[] = [];

  if (!/^services:/m.test(content)) {
    issues.push(createIssue('error', 'compose 文件缺少 services', '请使用标准 services 结构定义服务'));
  }

  if (!/\bports:\b/m.test(content)) {
    issues.push(createIssue('warning', '未显式暴露端口', '建议添加 ports 以便服务发现'));
  }

  if (!/\bvolumes:\b/m.test(content)) {
    issues.push(createIssue('warning', '未配置持久化存储', '建议将数据目录挂载到卷'));
  }

  return issues;
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function validateDockerfile(filePath: string): Promise<DockerFileReport> {
  const content = await readOptionalText(filePath);
  if (!content) {
    return {
      filePath,
      exists: false,
      issues: [createIssue('error', 'Dockerfile 不存在', '请在项目目录添加可解析的 Dockerfile')],
      score: 0
    };
  }

  const issues = validateDockerfileContent(content);
  return {
    filePath,
    exists: true,
    issues,
    score: normalizeScore(issues)
  };
}

export async function validateCompose(filePath: string): Promise<DockerFileReport> {
  const content = await readOptionalText(filePath);
  if (!content) {
    return {
      filePath,
      exists: false,
      issues: [createIssue('warning', 'docker-compose 文件缺失', '如需本地编排部署请补充 docker-compose.yml')],
      score: 50
    };
  }

  const issues = validateComposeContent(content);
  return {
    filePath,
    exists: true,
    issues,
    score: normalizeScore(issues)
  };
}

export async function scanDockerProject(projectPath: string): Promise<DockerProjectReport> {
  const dockerfilePath = path.join(projectPath, 'Dockerfile');
  const composePath = path.join(projectPath, 'docker-compose.yml');

  const dockerfile = await validateDockerfile(dockerfilePath);
  const composeFile = await validateCompose(composePath);

  return {
    projectPath,
    dockerfile,
    composeFile,
    hasArtifacts: dockerfile.exists || composeFile.exists
  };
}
