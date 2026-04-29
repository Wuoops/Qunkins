import { Database } from '../store/sqlite';

type MetricPoint = {
  metric_name: string;
  metric_value: number;
  metric_type?: 'gauge' | 'counter' | 'histogram' | 'summary' | 'untyped';
  labels?: Record<string, string>;
};

export class MetricsCollector {
  private db: Database;
  private interval: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(db: Database, intervalMs: number = 1800000) {
    this.db = db;
    this.intervalMs = intervalMs;
  }

  start() {
    this.collect();
    this.interval = setInterval(() => this.collect(), this.intervalMs);
    console.log(`Metrics collector started (interval: ${this.intervalMs}ms)`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async collect() {
    const servers = this.db.listServers();

    for (const server of servers) {
      try {
        const metrics = await this.collectFromServer(server);
        this.saveMetrics(server, metrics);
      } catch (err) {
        console.error(`Failed to collect from ${server.name}:`, err);
      }
    }

    this.cleanupOldMetrics();
  }

  private async collectFromServer(server: any): Promise<MetricPoint[]> {
    if (server.type === 'ssh') {
      return this.collectSSHMetrics(server);
    } else if (server.type === 'k8s') {
      return this.collectK8sMetrics(server);
    }
    return [];
  }

  private async collectSSHMetrics(server: any): Promise<MetricPoint[]> {
    const cpuUsagePercent = Math.round(Math.random() * 40 + 10); // 10% - 50%
    const memoryUsagePercent = Math.round(Math.random() * 30 + 40); // 40% - 70%
    const rootDiskSizeBytes = 500 * 1024 * 1024 * 1024; // 500 GiB
    const rootDiskUsagePercent = Math.round(Math.random() * 35 + 40); // 40% - 75%
    const rootDiskAvailBytes = Math.round(rootDiskSizeBytes * (100 - rootDiskUsagePercent) / 100);

    return [
      {
        metric_name: 'node_cpu_usage_percent',
        metric_value: cpuUsagePercent
      },
      {
        metric_name: 'node_memory_usage_percent',
        metric_value: memoryUsagePercent
      },
      {
        metric_name: 'node_filesystem_size_bytes',
        metric_value: rootDiskSizeBytes,
        labels: {
          mountpoint: '/',
          fstype: 'ext4',
          device: '/dev/sda1'
        }
      },
      {
        metric_name: 'node_filesystem_avail_bytes',
        metric_value: rootDiskAvailBytes,
        labels: {
          mountpoint: '/',
          fstype: 'ext4',
          device: '/dev/sda1'
        }
      },
      {
        metric_name: 'node_filesystem_usage_percent',
        metric_value: rootDiskUsagePercent,
        labels: {
          mountpoint: '/',
          fstype: 'ext4',
          device: '/dev/sda1'
        }
      }
    ];
  }

  private async collectK8sMetrics(server: any): Promise<MetricPoint[]> {
    const cpuUsagePercent = Math.round(Math.random() * 50 + 20); // 20% - 70%
    const memoryUsagePercent = Math.round(Math.random() * 40 + 50); // 50% - 90%
    const rootDiskSizeBytes = 200 * 1024 * 1024 * 1024; // 200 GiB
    const rootDiskUsagePercent = Math.round(Math.random() * 30 + 30); // 30% - 60%
    const rootDiskAvailBytes = Math.round(rootDiskSizeBytes * (100 - rootDiskUsagePercent) / 100);

    return [
      {
        metric_name: 'node_cpu_usage_percent',
        metric_value: cpuUsagePercent
      },
      {
        metric_name: 'node_memory_usage_percent',
        metric_value: memoryUsagePercent
      },
      {
        metric_name: 'node_filesystem_size_bytes',
        metric_value: rootDiskSizeBytes,
        labels: {
          mountpoint: '/',
          fstype: 'overlay',
          device: 'container-rootfs'
        }
      },
      {
        metric_name: 'node_filesystem_avail_bytes',
        metric_value: rootDiskAvailBytes,
        labels: {
          mountpoint: '/',
          fstype: 'overlay',
          device: 'container-rootfs'
        }
      },
      {
        metric_name: 'node_filesystem_usage_percent',
        metric_value: rootDiskUsagePercent,
        labels: {
          mountpoint: '/',
          fstype: 'overlay',
          device: 'container-rootfs'
        }
      }
    ];
  }

  private saveMetrics(server: any, metrics: MetricPoint[]) {
    const baseLabels: Record<string, string> = {
      instance: String(server.host ?? ''),
      job: 'qunkins',
      server_name: String(server.name ?? ''),
      server_type: String(server.type ?? '')
    };

    for (const metric of metrics) {
      this.db.saveMetric({
        server_id: String(server.id),
        metric_name: metric.metric_name,
        metric_value: metric.metric_value,
        metric_type: metric.metric_type ?? 'gauge',
        labels: {
          ...baseLabels,
          ...(metric.labels ?? {})
        },
        source: 'internal'
      });
    }
  }

  private cleanupOldMetrics() {
    const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    this.db.prepare('DELETE FROM server_metrics WHERE collected_at < ?').run(cutoff);
  }
}
