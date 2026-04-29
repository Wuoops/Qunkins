import type { SkillManifest } from './loader';

export interface RenderContext {
  role?: string;
  projectPath?: string;
  projectType?: string;
  [key: string]: string | number | boolean | undefined;
}

export function renderSkillManifest(
  manifest: SkillManifest,
  context: RenderContext = {}
): string {
  const lines: string[] = [];
  lines.push(`# ${manifest.name}`);
  lines.push(`角色：${manifest.mode || '未知角色'}`);
  if (context.role) {
    lines.push(`当前身份：${context.role}`);
  }
  if (context.projectPath) {
    lines.push(`项目路径：${context.projectPath}`);
  }
  if (context.projectType) {
    lines.push(`项目类型：${context.projectType}`);
  }
  if (manifest.description) {
    lines.push(`说明：${manifest.description}`);
  }
  lines.push('');
  lines.push('## 指令与规则');
  lines.push(renderTemplate(manifest.body, context));
  return lines.join('\n');
}

function renderTemplate(raw: string, context: RenderContext): string {
  return raw.replace(/\{\{([^}]+)\}\}/g, (match, keyRaw) => {
    const key = String(keyRaw).trim();
    if (!key) {
      return match;
    }
    const value = context[key];
    if (value === undefined) {
      return match;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return String(value);
  });
}

export function injectRuleHints(
  rendered: string,
  hints: string[]
): string {
  if (!hints.length) {
    return rendered;
  }

  return `${rendered}\n\n## 规则摘要\n${hints.map((item) => `- ${item}`).join('\n')}`;
}
