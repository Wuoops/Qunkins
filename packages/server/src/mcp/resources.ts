import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Database } from '@qunkins/core';
import { PipelineScheduler } from '@qunkins/core/pipeline/scheduler';

// Singleton database instance
let dbInstance: Database | undefined;
let schedulerInstance: PipelineScheduler | undefined;

function getDb(): Database {
  if (!dbInstance) {
    dbInstance = new Database(process.env.QUNKINS_DB_PATH || './data/qunkins.db');
  }
  return dbInstance;
}

function getScheduler(): PipelineScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new PipelineScheduler(getDb());
  }
  return schedulerInstance;
}

export function registerResources(server: Server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        { uri: 'qunkins://pipelines', name: 'All Pipelines', mimeType: 'application/json' },
        { uri: 'qunkins://servers', name: 'All Servers', mimeType: 'application/json' },
        { uri: 'qunkins://runs/recent', name: 'Recent Runs', mimeType: 'application/json' },
        { uri: 'qunkins://metrics/summary', name: 'Metrics Summary', mimeType: 'application/json' },
        { uri: 'qunkins://pipelines/schedules', name: 'Active Pipeline Schedules', mimeType: 'application/json' }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const db = getDb();
    
    let data: any;
    switch (uri) {
      case 'qunkins://pipelines':
        data = db.listPipelines();
        break;
      case 'qunkins://servers':
        data = db.listServers();
        break;
      case 'qunkins://runs/recent':
        data = db.getRecentRuns();
        break;
      case 'qunkins://metrics/summary':
        data = db.getLatestMetrics();
        break;
      case 'qunkins://pipelines/schedules':
        data = getScheduler().getStatus();
        break;
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }

    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  });
}
