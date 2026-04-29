import fs from 'fs/promises';

export interface FailureAnalysis {
  status: 'ok' | 'failed';
  summary: string;
  likelyCause: string;
  recommendations: string[];
  evidence: string[];
}

export interface AnalyzeFailureOptions {
  maxTailLines?: number;
  includeContextLines?: number;
}

function getErrorHints(lines: string[]): string[] {
  const errorRules: Array<{ pattern: RegExp; cause: string; advice: string }> = [
    {
      pattern: /command not found|not found:|is not recognized/i,
      cause: '命令缺失或未安装',
      advice: '检查执行步骤中的命令是否安装，或补充镜像内依赖'
    },
    {
      pattern: /permission denied|denied:|EACCES/i,
      cause: '权限不足',
      advice: '检查用户权限、文件可执行权限、脚本执行位'
    },
    {
      pattern: /No such file or directory/i,
      cause: '路径或文件不存在',
      advice: '确认构建上下文与 COPY/WORKDIR/脚本路径一致'
    },
    {
      pattern: /syntax error|Syntax error|unexpected token/i,
      cause: '脚本语法错误',
      advice: '核查 shell 脚本或配置文件语法并按行修复'
    },
    {
      pattern: /npm ERR!|yarn error|pnpm ERR!/i,
      cause: '依赖安装失败',
      advice: '清理 lockfile/缓存并检查镜像网络与 registry 配置'
    },
    {
      pattern: /exit code 1|code 1/i,
      cause: '执行步骤返回错误码',
      advice: '定位失败命令，查看该步骤日志的前后文'
    }
  ];

  return lines
    .filter((line) => line.trim())
    .filter((line) => errorRules.some((rule) => rule.pattern.test(line)))
    .slice(0, 20);
}

function buildRecommendations(errorHints: string[]): string[] {
  if (errorHints.length === 0) {
    return [
      '日志中未识别到明确错误关键字',
      '请查看失败脚本的前后 30 行日志确认具体失败点'
    ];
  }

  const mapped = new Map<string, string>();

  for (const line of errorHints) {
    const lowered = line.toLowerCase();
    if (/command not found|not found:|is not recognized/.test(lowered)) {
      mapped.set('command', '检查并安装缺失命令；确认脚本中的命令顺序');
    }
    if (/permission denied|eacces|denied/.test(lowered)) {
      mapped.set('perm', '修正权限问题，避免直接运行未授权文件');
    }
    if (/no such file/.test(lowered)) {
      mapped.set('path', '确认构建上下文、路径、文件名和挂载规则');
    }
    if (/npm err|yarn error|pnpm err/.test(lowered)) {
      mapped.set('deps', '检查依赖安装参数、缓存配置、registry 地址');
    }
    if (/exit code 1/.test(lowered) || /syntax error/.test(lowered)) {
      mapped.set('step', '回退本次变更并逐步重放失败步骤');
    }
  }

  return Array.from(mapped.values());
}

function takeTail(lines: string[], max: number): string[] {
  if (max <= 0) {
    return lines;
  }

  return lines.slice(-max);
}

export async function analyzeFailureFromLog(
  logPath: string,
  options: AnalyzeFailureOptions = {}
): Promise<FailureAnalysis> {
  const maxTailLines = options.maxTailLines ?? 200;

  try {
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const tail = takeTail(lines, maxTailLines);

    const errorHints = getErrorHints(tail);
    const evidence = errorHints.slice(0, 10);
    const recommendations = buildRecommendations(errorHints);

    return {
      status: 'failed',
      summary: `检测到 ${errorHints.length} 条失败线索`,
      likelyCause: errorHints[0] || '未知失败原因',
      recommendations,
      evidence
    };
  } catch (error) {
    return {
      status: 'failed',
      summary: '日志读取失败',
      likelyCause: '无法读取流水线日志文件',
      recommendations: [
        '确认 log_path 在运行结束后未被清理',
        '检查服务是否有目录读写权限'
      ],
      evidence: [
        (error instanceof Error ? error.message : String(error))
      ]
    };
  }
}

export async function analyzeFailure(
  run: { log_path?: string; error_summary?: string | null },
  options: AnalyzeFailureOptions = {}
): Promise<FailureAnalysis> {
  if (!run?.log_path) {
    return {
      status: 'failed',
      summary: '缺少运行日志路径',
      likelyCause: '流水线运行日志未记录',
      recommendations: ['检查执行器是否正确设置 log_path', '确认日志目录是否可写'],
      evidence: []
    };
  }

  return analyzeFailureFromLog(run.log_path, options);
}
