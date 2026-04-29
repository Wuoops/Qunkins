import { Database } from '../store/sqlite';
import { PipelineExecutor } from './executor';
import crypto from 'crypto';

export interface PipelineSchedule {
  id: string;
  pipelineId: string;
  intervalMs: number;
  branch?: string;
}

interface ActiveSchedule extends PipelineSchedule {
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
  runs: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastError?: string;
  running: boolean;
}

export interface ScheduleOptions {
  branch?: string;
  runImmediate?: boolean;
}

export class PipelineScheduler {
  private readonly db: Database;
  private readonly executor: PipelineExecutor;
  private readonly schedules = new Map<string, ActiveSchedule>();

  constructor(db: Database, executor = new PipelineExecutor(db)) {
    this.db = db;
    this.executor = executor;
  }

  schedule(pipelineId: string, intervalMs: number, options: ScheduleOptions = {}): PipelineSchedule {
    const normalizedInterval = Math.max(1000, Math.floor(intervalMs));
    const pipeline = this.db.getPipeline(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} does not exist`);
    }

    if (this.schedules.has(pipelineId)) {
      this.unschedule(pipelineId);
    }

    const scheduleId = `schedule_${crypto.randomUUID()}`;
    const active: ActiveSchedule = {
      id: scheduleId,
      pipelineId,
      intervalMs: normalizedInterval,
      branch: options.branch,
      timer: setInterval(async () => {
        await this.runScheduledPipeline(pipelineId, options.branch, active);
      }, normalizedInterval),
      startedAt: Date.now(),
      runs: 0,
      running: false
    };

    this.schedules.set(pipelineId, active);

    if (options.runImmediate) {
      void this.runScheduledPipeline(pipelineId, options.branch, active);
    }

    return {
      id: scheduleId,
      pipelineId,
      intervalMs: normalizedInterval,
      branch: options.branch
    };
  }

  unschedule(pipelineId: string): boolean {
    const active = this.schedules.get(pipelineId);
    if (!active) {
      return false;
    }

    clearInterval(active.timer);
    this.schedules.delete(pipelineId);
    return true;
  }

  listSchedules(): PipelineSchedule[] {
    return Array.from(this.schedules.values()).map((schedule) => ({
      id: schedule.id,
      pipelineId: schedule.pipelineId,
      intervalMs: schedule.intervalMs,
      branch: schedule.branch
    }));
  }

  getStatus(): Array<{
    pipelineId: string;
    intervalMs: number;
    runs: number;
    lastRunAt?: number;
    lastRunId?: string;
    lastError?: string;
    running: boolean;
  }> {
    return Array.from(this.schedules.values()).map((schedule) => ({
      pipelineId: schedule.pipelineId,
      intervalMs: schedule.intervalMs,
      runs: schedule.runs,
      lastRunAt: schedule.lastRunAt,
      lastRunId: schedule.lastRunId,
      lastError: schedule.lastError,
      running: schedule.running
    }));
  }

  stopAll(): void {
    for (const pipelineId of this.schedules.keys()) {
      this.unschedule(pipelineId);
    }
  }

  private async runScheduledPipeline(
    pipelineId: string,
    branch: string | undefined,
    active: ActiveSchedule
  ): Promise<void> {
    if (active.running) {
      return;
    }

    active.running = true;
    active.runs += 1;

    try {
      const runId = await this.executor.run(pipelineId, branch);
      active.lastRunId = runId;
      active.lastRunAt = Date.now();
      active.lastError = undefined;
    } catch (error) {
      active.lastError = error instanceof Error ? error.message : 'unknown scheduler error';
    } finally {
      active.running = false;
    }
  }
}
