import { Client, type ConnectConfig } from 'ssh2';
import { Database } from '../store/sqlite.js';
import { decrypt } from '../crypto/aes.js';

export class HeartbeatChecker {
  private db: Database;
  private secret: string;
  private interval: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(db: Database, secret: string, intervalMs: number = 60_000) {
    this.db = db;
    this.secret = secret;
    this.intervalMs = intervalMs;
  }

  start() {
    this.checkAll();
    this.interval = setInterval(() => this.checkAll(), this.intervalMs);
    console.log(`Heartbeat checker started (interval: ${this.intervalMs}ms)`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkAll() {
    const servers = this.db.listServers();
    const results = await Promise.allSettled(
      servers.map((s: any) => this.checkServer(s))
    );

    for (let i = 0; i < servers.length; i++) {
      const server = servers[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        this.db.upsertHeartbeat(server.id, result.value);
      } else {
        this.db.upsertHeartbeat(server.id, {
          online: false,
          error: result.reason?.message || 'Unknown error',
        });
      }
    }
  }

  private async checkServer(server: any): Promise<{ online: boolean; os_info?: string; docker_version?: string; error?: string }> {
    try {
      const credentials = JSON.parse(decrypt(server.credentials_enc, this.secret));
      const config: ConnectConfig = {
        host: server.host,
        port: server.port || 22,
        username: credentials.username || 'root',
        readyTimeout: 5000,
      };

      if (credentials.privateKey) {
        config.privateKey = credentials.privateKey;
        if (credentials.passphrase) config.passphrase = credentials.passphrase;
      } else if (credentials.password) {
        config.password = credentials.password;
      }

      const output = await this.sshExec(config, 'uname -a && docker --version 2>/dev/null || echo "docker: not installed"', 8000);
      const lines = output.trim().split('\n');
      const osInfo = lines[0] || '';
      const dockerLine = lines.find(l => l.startsWith('Docker version')) || lines[lines.length - 1] || '';

      return {
        online: true,
        os_info: osInfo,
        docker_version: dockerLine,
      };
    } catch (err) {
      return {
        online: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private sshExec(config: ConnectConfig, command: string, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error('SSH command timeout'));
      }, timeoutMs);

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { clearTimeout(timer); conn.end(); return reject(err); }
          stream.on('data', (data: Buffer) => { output += data.toString(); });
          stream.stderr.on('data', (data: Buffer) => { output += data.toString(); });
          stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(output); });
        });
      });
      conn.on('error', (err) => { clearTimeout(timer); reject(err); });
      conn.connect(config);
    });
  }
}
