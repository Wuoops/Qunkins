import { Database } from '../store/sqlite';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { analyzeFailure } from '../notifier/analyzer';

export class PipelineExecutor {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async run(
    pipelineId: string,
    branch?: string,
    triggeredBy = 'mcp'
  ): Promise<string> {
    const pipeline = this.db.getPipeline(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    const runId = `run_${crypto.randomUUID()}`;
    const config = JSON.parse(pipeline.config_enc);
    const logDir = process.env.QUNKINS_LOG_DIR || './logs';
    
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logPath = path.join(logDir, `${runId}.log`);

    // Create run record
    this.db.createPipelineRun({
      id: runId,
      pipeline_id: pipelineId,
      status: 'running',
      triggered_by: triggeredBy,
      log_path: logPath
    });

    // Execute pipeline steps
    try {
      for (const step of config.steps || []) {
        await this.executeStep(step, logPath);
      }
      this.db.updatePipelineRunStatus(runId, 'success');
    } catch (err) {
      const analysis = await analyzeFailure({
        log_path: logPath,
        error_summary: (err as Error).message
      });
      this.db.updatePipelineRunStatus(
        runId,
        'failed',
        `${(err as Error).message}\n${analysis.summary}\n${analysis.likelyCause}`
      );
    }

    return runId;
  }

  private executeStep(step: { command: string; args?: string[] }, logPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { command, args = [] } = step;
      
      const proc = spawn(command, args, { shell: true });
      
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      proc.stdout.pipe(logStream);
      proc.stderr.pipe(logStream);

      proc.on('close', (code) => {
        logStream.end();
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command "${command}" failed with exit code ${code}`));
        }
      });

      proc.on('error', (err) => {
        logStream.end();
        reject(err);
      });
    });
  }
}
