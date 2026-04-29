import { detectProjectType, generatePipelineYaml } from './generator';
import { parsePipelineYamlString } from './parser';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('detectProjectType', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qunkins-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should detect nodejs from package.json', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
    const result = await detectProjectType(tmpDir);
    expect(result.type).toBe('nodejs');
    expect(result.indicators).toContain('package.json');
  });

  it('should detect python from requirements.txt', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), '');
    const result = await detectProjectType(tmpDir);
    expect(result.type).toBe('python');
  });

  it('should detect go from go.mod', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module test');
    const result = await detectProjectType(tmpDir);
    expect(result.type).toBe('go');
  });

  it('should detect java from pom.xml', async () => {
    await fs.writeFile(path.join(tmpDir, 'pom.xml'), '<project/>');
    const result = await detectProjectType(tmpDir);
    expect(result.type).toBe('java');
  });

  it('should return unknown for empty directory', async () => {
    const result = await detectProjectType(tmpDir);
    expect(result.type).toBe('unknown');
    expect(result.indicators).toHaveLength(0);
  });
});

describe('generatePipelineYaml', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qunkins-gen-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should generate valid YAML for a nodejs project', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
    const result = await generatePipelineYaml(tmpDir);

    expect(result.projectType).toBe('nodejs');
    expect(result.yaml).toContain('npm ci');

    const parsed = parsePipelineYamlString(result.yaml);
    expect(parsed.ok).toBe(true);
  });

  it('should generate valid YAML for a python project', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'flask');
    const result = await generatePipelineYaml(tmpDir);

    expect(result.projectType).toBe('python');
    expect(result.yaml).toContain('pip install');
  });

  it('should use a custom template when provided', async () => {
    const template = {
      version: '1' as const,
      name: 'custom',
      docker: { context: '.', dockerfile: 'Dockerfile' },
      stages: [{ name: 'deploy', steps: [{ run: 'make deploy' }] }],
    };

    const result = await generatePipelineYaml(tmpDir, { template });
    expect(result.yaml).toContain('make deploy');
  });

  it('should use custom name when provided', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module test');
    const result = await generatePipelineYaml(tmpDir, { name: 'my-service' });
    expect(result.pipeline.name).toBe('my-service');
  });
});
