import path from 'path';
import fs from 'fs/promises';
import { loadSkillManifest } from './loader';
import { renderSkillManifest, injectRuleHints } from './renderer';

export interface SkillBuildOptions {
  role?: string;
  projectType?: string;
  ruleFiles?: string[];
  context?: Record<string, string>;
}

export interface SkillBuildResult {
  skillPath: string;
  renderedPrompt: string;
  hintCount: number;
}

async function readRuleHints(rulePaths: string[] = []): Promise<string[]> {
  const results = await Promise.all(
    rulePaths.map(async (rulePath) => {
      try {
        const content = await fs.readFile(rulePath, 'utf8');
        return content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 5);
      } catch {
        return [];
      }
    })
  );

  return results.flat();
}

export async function buildSkillPrompt(
  skillRoot: string,
  options: SkillBuildOptions = {}
): Promise<SkillBuildResult> {
  const skillPath = path.join(skillRoot, 'SKILL.md');
  const manifest = await loadSkillManifest(skillPath);

  if (!manifest) {
    throw new Error(`Skill manifest not found: ${skillPath}`);
  }

  const rendered = renderSkillManifest(manifest, {
    role: options.role,
    projectType: options.projectType,
    ...options.context
  });
  const hints = await readRuleHints(options.ruleFiles);
  const withHints = injectRuleHints(rendered, hints);

  return {
    skillPath,
    renderedPrompt: withHints,
    hintCount: hints.length
  };
}
