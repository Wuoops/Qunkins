import { PipelineYamlSchema } from './schema';
import { parsePipelineYamlString, pipelineToYamlString } from './parser';

describe('PipelineYamlSchema', () => {
  it('should validate a minimal valid pipeline', () => {
    const result = PipelineYamlSchema.safeParse({
      name: 'test-pipeline',
      stages: [{ name: 'build', steps: [{ run: 'echo hello' }] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1');
      expect(result.data.docker.context).toBe('.');
      expect(result.data.docker.dockerfile).toBe('Dockerfile');
    }
  });

  it('should reject pipeline without name', () => {
    const result = PipelineYamlSchema.safeParse({
      stages: [{ name: 'build', steps: [{ run: 'echo' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject pipeline without stages', () => {
    const result = PipelineYamlSchema.safeParse({ name: 'test', stages: [] });
    expect(result.success).toBe(false);
  });

  it('should reject stage without steps', () => {
    const result = PipelineYamlSchema.safeParse({
      name: 'test',
      stages: [{ name: 'build', steps: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('should accept custom docker config', () => {
    const result = PipelineYamlSchema.safeParse({
      name: 'test',
      docker: { context: './app', dockerfile: 'Dockerfile.prod', image: 'node:20' },
      stages: [{ name: 'build', steps: [{ run: 'npm run build' }] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.docker.image).toBe('node:20');
    }
  });

  it('should accept artifacts and env', () => {
    const result = PipelineYamlSchema.safeParse({
      name: 'test',
      stages: [{ name: 'build', steps: [{ run: 'make' }] }],
      artifacts: ['dist/', 'build/'],
      env: { NODE_ENV: 'production' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artifacts).toEqual(['dist/', 'build/']);
      expect(result.data.env).toEqual({ NODE_ENV: 'production' });
    }
  });
});

describe('parsePipelineYamlString', () => {
  it('should parse valid YAML', () => {
    const yaml = `
version: "1"
name: my-app
stages:
  - name: build
    steps:
      - run: npm run build
`;
    const result = parsePipelineYamlString(yaml);
    expect(result.ok).toBe(true);
    expect(result.pipeline?.name).toBe('my-app');
    expect(result.pipeline?.stages).toHaveLength(1);
  });

  it('should return errors for invalid YAML syntax', () => {
    const result = parsePipelineYamlString('invalid: [unclosed');
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should return errors for missing required fields', () => {
    const result = parsePipelineYamlString('version: "1"');
    expect(result.ok).toBe(false);
  });
});

describe('pipelineToYamlString', () => {
  it('should produce valid YAML that can be parsed back', () => {
    const pipeline = {
      version: '1',
      name: 'roundtrip-test',
      docker: { context: '.', dockerfile: 'Dockerfile' },
      stages: [
        { name: 'install', steps: [{ run: 'npm ci' }] },
        { name: 'test', steps: [{ run: 'npm test' }] },
      ],
    };

    const yamlStr = pipelineToYamlString(pipeline);
    const parsed = parsePipelineYamlString(yamlStr);

    expect(parsed.ok).toBe(true);
    expect(parsed.pipeline?.name).toBe('roundtrip-test');
    expect(parsed.pipeline?.stages).toHaveLength(2);
  });
});
