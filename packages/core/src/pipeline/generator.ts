import fs from 'fs/promises';
import path from 'path';
import type { PipelineYaml } from './schema';
import { pipelineToYamlString } from './parser';

export type ProjectType = 'nodejs' | 'python' | 'go' | 'java' | 'unknown';

interface DetectResult {
  type: ProjectType;
  indicators: string[];
}

const DETECTION_FILES: Record<string, ProjectType> = {
  'package.json': 'nodejs',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
};

export async function detectProjectType(projectPath: string): Promise<DetectResult> {
  const indicators: string[] = [];
  let detected: ProjectType = 'unknown';

  for (const [file, type] of Object.entries(DETECTION_FILES)) {
    try {
      await fs.access(path.join(projectPath, file));
      indicators.push(file);
      if (detected === 'unknown') {
        detected = type;
      }
    } catch {
      // file doesn't exist
    }
  }

  return { type: detected, indicators };
}

function generateNodejsPipeline(name: string): PipelineYaml {
  return {
    version: '1',
    name,
    docker: { context: '.', dockerfile: 'Dockerfile' },
    stages: [
      { name: 'install', steps: [{ run: 'npm ci' }] },
      { name: 'test', steps: [{ run: 'npm test' }] },
      { name: 'build', steps: [{ run: 'npm run build' }] },
    ],
    artifacts: ['dist/'],
  };
}

function generatePythonPipeline(name: string): PipelineYaml {
  return {
    version: '1',
    name,
    docker: { context: '.', dockerfile: 'Dockerfile' },
    stages: [
      { name: 'install', steps: [{ run: 'pip install -r requirements.txt' }] },
      { name: 'test', steps: [{ run: 'pytest' }] },
      { name: 'build', steps: [{ run: 'python -m build' }] },
    ],
  };
}

function generateGoPipeline(name: string): PipelineYaml {
  return {
    version: '1',
    name,
    docker: { context: '.', dockerfile: 'Dockerfile' },
    stages: [
      { name: 'download', steps: [{ run: 'go mod download' }] },
      { name: 'test', steps: [{ run: 'go test ./...' }] },
      { name: 'build', steps: [{ run: 'go build -o app .' }] },
    ],
    artifacts: ['app'],
  };
}

function generateJavaPipeline(name: string): PipelineYaml {
  return {
    version: '1',
    name,
    docker: { context: '.', dockerfile: 'Dockerfile' },
    stages: [
      { name: 'build', steps: [{ run: 'mvn clean package -DskipTests' }] },
      { name: 'test', steps: [{ run: 'mvn test' }] },
    ],
    artifacts: ['target/*.jar'],
  };
}

function generateFallbackPipeline(name: string): PipelineYaml {
  return {
    version: '1',
    name,
    docker: { context: '.', dockerfile: 'Dockerfile' },
    stages: [
      { name: 'build', steps: [{ run: 'echo "Add your build commands here"' }] },
      { name: 'test', steps: [{ run: 'echo "Add your test commands here"' }] },
    ],
  };
}

const GENERATORS: Record<ProjectType, (name: string) => PipelineYaml> = {
  nodejs: generateNodejsPipeline,
  python: generatePythonPipeline,
  go: generateGoPipeline,
  java: generateJavaPipeline,
  unknown: generateFallbackPipeline,
};

export async function generatePipelineYaml(
  projectPath: string,
  options: { name?: string; template?: PipelineYaml } = {}
): Promise<{ yaml: string; pipeline: PipelineYaml; projectType: ProjectType }> {
  if (options.template) {
    return {
      yaml: pipelineToYamlString(options.template),
      pipeline: options.template,
      projectType: 'unknown',
    };
  }

  const { type } = await detectProjectType(projectPath);
  const projectName = options.name || path.basename(projectPath);
  const generator = GENERATORS[type];
  const pipeline = generator(projectName);

  return {
    yaml: pipelineToYamlString(pipeline),
    pipeline,
    projectType: type,
  };
}
