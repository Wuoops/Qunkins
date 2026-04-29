import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export class QunkinsMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: 'qunkins', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    registerTools(this.server);
    registerResources(this.server);
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start server if run directly
const server = new QunkinsMCPServer();
server.start().catch(console.error);
