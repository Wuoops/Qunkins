import fs from 'fs/promises';

export interface SkillManifest {
  name: string;
  description: string;
  path: string;
  mode?: string;
  raw: string;
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(source: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const trimmed = source.trim();
  if (!trimmed.startsWith('---')) {
    return {
      frontmatter: {},
      body: source
    };
  }

  const end = trimmed.indexOf('---', 3);
  if (end === -1) {
    return {
      frontmatter: {},
      body: source
    };
  }

  const rawHeader = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 3).trimStart();
  const lines = rawHeader.split('\n');
  const frontmatter: Record<string, string> = {};

  for (const line of lines) {
    const sep = line.indexOf(':');
    if (sep === -1) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

function guessTitle(body: string): string {
  const titleLine = body.split('\n').find((line) => line.startsWith('# '));
  return titleLine ? titleLine.replace(/^#\s*/, '').trim() : 'Unnamed Skill';
}

export async function loadSkillManifest(skillPath: string): Promise<SkillManifest | null> {
  try {
    const source = await fs.readFile(skillPath, 'utf8');
    const parsed = parseFrontmatter(source);
    return {
      name: parsed.frontmatter.name || parsed.frontmatter.description || guessTitle(parsed.body),
      description: parsed.frontmatter.description || guessTitle(parsed.body),
      path: skillPath,
      mode: parsed.frontmatter.mode || 'subagent',
      raw: source,
      frontmatter: parsed.frontmatter,
      body: parsed.body
    };
  } catch {
    return null;
  }
}

export async function loadSkillInstructionText(skillPath: string): Promise<string | null> {
  const manifest = await loadSkillManifest(skillPath);
  if (!manifest) {
    return null;
  }
  return manifest.body;
}
