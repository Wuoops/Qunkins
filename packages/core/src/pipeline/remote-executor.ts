import { Client, type ConnectConfig } from 'ssh2';
import { Database } from '../store/sqlite';
import { decrypt } from '../crypto/aes';
import { parsePipelineYamlString } from './parser';
import type { PipelineYaml } from './schema';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface TriggerRequest {
  repo_url: string;
  branch: string;
  commit_sha?: string;
  triggered_by: string;
}

export interface RunResult {
  runId: string;
  serverId: string;
  status: 'success' | 'failed';
  error?: string;
}

export class RemoteExecutor {
  private db: Database;
  private secret: string;
  private logDir: string;

  constructor(db: Database, secret: string, logDir = './logs') {
    this.db = db;
    this.secret = secret;
    this.logDir = logDir;

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  async testConnection(serverId: string): Promise<{ ok: boolean; server: string; host: string; detail: string }> {
    const servers = this.db.listServers();
    const server = servers.find((s: any) => s.id === serverId);
    if (!server) {
      return { ok: false, server: serverId, host: '', detail: `Server ${serverId} not found` };
    }

    try {
      const credentials = JSON.parse(decrypt(server.credentials_enc, this.secret));
      const config = this.buildSSHConfig(server, credentials);
      const output = await this.sshExec(config, 'echo ok && uname -a && docker --version 2>/dev/null || echo "docker not installed"');
      return {
        ok: true,
        server: server.name,
        host: server.host,
        detail: output.trim(),
      };
    } catch (err) {
      return {
        ok: false,
        server: server.name,
        host: server.host,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async trigger(request: TriggerRequest): Promise<RunResult> {
    const servers = this.db.listServers();
    if (servers.length === 0) {
      throw new Error('No execution nodes available. Ask your admin to add a server.');
    }

    const server = servers[Math.floor(Math.random() * servers.length)];

    const runId = `run_${crypto.randomUUID()}`;
    const logPath = path.join(this.logDir, `${runId}.log`);

    this.db.createPipelineRun({
      id: runId,
      pipeline_id: `adhoc_${crypto.randomUUID()}`,
      status: 'running',
      triggered_by: request.triggered_by,
      log_path: logPath,
    });

    try {
      const credentials = JSON.parse(decrypt(server.credentials_enc, this.secret));
      const connectConfig = this.buildSSHConfig(server, credentials);

      const pipelineYaml = await this.fetchPipelineYaml(
        connectConfig,
        request.repo_url,
        request.branch
      );

      const parseResult = parsePipelineYamlString(pipelineYaml);
      if (!parseResult.ok || !parseResult.pipeline) {
        const errMsg = `Invalid pipeline.yaml: ${(parseResult.errors ?? []).join('; ')}`;
        this.db.updatePipelineRunStatus(runId, 'failed', errMsg);
        return { runId, serverId: server.id, status: 'failed', error: errMsg };
      }

      await this.executePipeline(connectConfig, request, parseResult.pipeline, logPath);

      this.db.updatePipelineRunStatus(runId, 'success');
      return { runId, serverId: server.id, status: 'success' };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.db.updatePipelineRunStatus(runId, 'failed', errMsg);
      return { runId, serverId: server.id, status: 'failed', error: errMsg };
    }
  }

  private buildSSHConfig(server: any, credentials: any): ConnectConfig {
    const config: ConnectConfig = {
      host: server.host,
      port: server.port || 22,
      username: credentials.username || 'root',
    };

    if (credentials.privateKey) {
      config.privateKey = credentials.privateKey;
      if (credentials.passphrase) {
        config.passphrase = credentials.passphrase;
      }
    } else if (credentials.password) {
      config.password = credentials.password;
    }

    return config;
  }

  private fetchPipelineYaml(
    config: ConnectConfig,
    repoUrl: string,
    branch: string
  ): Promise<string> {
    const workDir = `/tmp/qunkins-${crypto.randomUUID()}`;
    const commands = [
      `mkdir -p ${workDir}`,
      `git clone --depth 1 --branch ${branch} ${repoUrl} ${workDir}/repo`,
      `cat ${workDir}/repo/.qunkins/pipeline.yaml`,
    ];

    return this.sshExec(config, commands.join(' && '));
  }

  private async executePipeline(
    config: ConnectConfig,
    request: TriggerRequest,
    pipeline: PipelineYaml,
    logPath: string
  ): Promise<void> {
    const workDir = `/tmp/qunkins-${crypto.randomUUID()}`;
    const imageName = `qunkins-build-${pipeline.name}:${request.commit_sha?.slice(0, 8) || 'latest'}`;

    const setupCommands = [
      `mkdir -p ${workDir}`,
      `git clone --branch ${request.branch} ${request.repo_url} ${workDir}/repo`,
    ];

    const dockerBuild = pipeline.docker.image
      ? `docker pull ${pipeline.docker.image}`
      : `cd ${workDir}/repo && docker build -t ${imageName} -f ${pipeline.docker.dockerfile} ${pipeline.docker.context}`;

    const effectiveImage = pipeline.docker.image || imageName;

    const stageCommands: string[] = [];
    for (const stage of pipeline.stages) {
      const stageScript = stage.steps.map((s) => s.run).join(' && ');
      stageCommands.push(
        `echo "=== Stage: ${stage.name} ===" && ` +
        `docker run --rm -v ${workDir}/repo:/workspace -w /workspace ${effectiveImage} sh -c '${stageScript.replace(/'/g, "'\\''")}'`
      );
    }

    const cleanupCmd = `rm -rf ${workDir}`;
    const fullScript = [
      ...setupCommands,
      dockerBuild,
      ...stageCommands,
      cleanupCmd,
    ].join(' && ');

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    try {
      const output = await this.sshExec(config, fullScript);
      logStream.write(output);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logStream.write(`\n\n=== EXECUTION FAILED ===\n${errMsg}\n`);
      throw err;
    } finally {
      logStream.end();
    }
  }

  private sshExec(config: ConnectConfig, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.on('close', (code: number) => {
            conn.end();
            if (code === 0) {
              resolve(output);
            } else {
              reject(new Error(`Remote command exited with code ${code}\n${output}`));
            }
          });
        });
      });

      conn.on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.connect(config);
    });
  }
}
