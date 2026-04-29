import fs from 'fs/promises';
import yaml from 'js-yaml';
import { PipelineYamlSchema, type PipelineYaml } from './schema';

export interface ParseResult {
  ok: boolean;
  pipeline?: PipelineYaml;
  errors?: string[];
  raw?: string;
}

export async function parsePipelineYaml(filePath: string): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return { ok: false, errors: [`pipeline.yaml not found: ${filePath}`] };
  }

  return parsePipelineYamlString(raw);
}

export function parsePipelineYamlString(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    return {
      ok: false,
      raw,
      errors: [`YAML syntax error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, raw, errors: ['pipeline.yaml is empty or not an object'] };
  }

  const result = PipelineYamlSchema.safeParse(parsed);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return { ok: false, raw, errors };
  }

  return { ok: true, pipeline: result.data, raw };
}

export function pipelineToYamlString(pipeline: PipelineYaml): string {
  return yaml.dump(pipeline, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
