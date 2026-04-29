import { Queue, Worker, QueueEvents, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

let connection: ConnectionOptions | null = null;
let feishuQueue: Queue | null = null;
let worker: Worker | null = null;

export interface FeishuJob {
  chatId: string;
  message: string;
  command?: string;
  sessionData?: Record<string, any>;
}

export interface FeishuSession {
  flow: string;
  step: string;
  data: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Initialize Redis connection for BullMQ
 */
export function initRedisConnection(config: {
  host?: string;
  port?: number;
  password?: string;
}) {
  connection = {
    host: config.host || process.env.REDIS_HOST || 'localhost',
    port: config.port || parseInt(process.env.REDIS_PORT || '6379', 10),
    password: config.password || process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  };
}

/**
 * Get or create the Feishu message queue
 */
export function getFeishuQueue(): Queue {
  if (!feishuQueue || !connection) {
    if (!connection) {
      initRedisConnection({});
    }
    feishuQueue = new Queue<FeishuJob>('feishu-messages', { connection: connection! });
  }
  return feishuQueue;
}

/**
 * Start the Feishu worker to process messages
 */
export function startFeishuWorker(
  handler: (job: FeishuJob) => Promise<void>
): Worker {
  if (!connection) {
    initRedisConnection({});
  }

  worker = new Worker<FeishuJob>('feishu-messages', async (job) => {
    await handler(job.data);
  }, { connection: connection! });

  const queueEvents = new QueueEvents('feishu-messages', { connection: connection! });
  
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`Job ${jobId} failed: ${failedReason}`);
  });

  queueEvents.on('completed', ({ jobId }) => {
    console.log(`Job ${jobId} completed`);
  });

  return worker;
}

/**
 * Add a message to the processing queue
 */
export async function queueMessage(jobData: FeishuJob): Promise<void> {
  const queue = getFeishuQueue();
  await queue.add('process-message', jobData, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  });
}

/**
 * Get session state from Redis
 */
export async function getSession(chatId: string): Promise<FeishuSession | null> {
  if (!connection) return null;
  
  const redis = new IORedis(connection as any);
  
  const key = `session:${chatId}`;
  const session = await redis.hgetall(key);
  await redis.quit();
  
  if (!session.flow) return null;
  
  return {
    flow: session.flow,
    step: session.step,
    data: JSON.parse(session.data || '{}'),
    createdAt: parseInt(session.createdAt || '0', 10),
    expiresAt: parseInt(session.expiresAt || '0', 10)
  };
}

/**
 * Create or update session in Redis
 */
export async function setSession(
  chatId: string,
  session: FeishuSession
): Promise<void> {
  if (!connection) return;
  
  const redis = new IORedis(connection as any);
  
  const key = `session:${chatId}`;
  await redis.hset(key, {
    flow: session.flow,
    step: session.step,
    data: JSON.stringify(session.data),
    createdAt: session.createdAt.toString(),
    expiresAt: session.expiresAt.toString()
  });
  
  // Set TTL to 5 minutes
  await redis.expire(key, 300);
  await redis.quit();
}

/**
 * Delete session
 */
export async function deleteSession(chatId: string): Promise<void> {
  if (!connection) return;
  
  const redis = new IORedis(connection as any);
  await redis.del(`session:${chatId}`);
  await redis.quit();
}

/**
 * Close all connections
 */
export async function closeConnections(): Promise<void> {
  if (worker) {
    await worker.close();
  }
  if (feishuQueue) {
    await feishuQueue.close();
  }
}
