import { Database } from './sqlite';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should initialize all tables', () => {
    // 9 tables from spec
    db.prepare('SELECT 1 FROM users').get();
    db.prepare('SELECT 1 FROM git_repos').get();
    db.prepare('SELECT 1 FROM repo_branches').get();
    db.prepare('SELECT 1 FROM servers').get();
    db.prepare('SELECT 1 FROM pipelines').get();
    db.prepare('SELECT 1 FROM pipeline_runs').get();
    db.prepare('SELECT 1 FROM notify_configs').get();
    db.prepare('SELECT 1 FROM rule_versions').get();
    db.prepare('SELECT 1 FROM server_metrics').get();
  });

  it('should insert and query user', () => {
    db.createUser({
      id: 'user-1',
      username: 'admin',
      role: 'admin'
    });
    
    const user = db.getUser('user-1');
    expect(user?.username).toBe('admin');
  });

  it('should insert and query git repo', () => {
    db.createGitRepo({
      id: 'repo-1',
      name: 'test-repo',
      platform: 'gitlab',
      base_url: 'https://gitlab.example.com',
      access_token_enc: 'encrypted-token'
    });
    
    const repos = db.listGitRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('test-repo');
  });

  it('should insert and query server', () => {
    db.createServer({
      id: 'server-1',
      name: 'prod-server',
      type: 'ssh',
      host: '192.168.1.100',
      port: 22,
      credentials_enc: 'encrypted-creds'
    });
    
    const servers = db.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].host).toBe('192.168.1.100');
  });

  it('should create and get pipeline', () => {
    db.createPipeline({
      id: 'pipeline-1',
      name: 'build-deploy',
      config_enc: JSON.stringify({ steps: ['build', 'deploy'] })
    });
    
    const pipeline = db.getPipeline('pipeline-1');
    expect(pipeline?.name).toBe('build-deploy');
  });

  it('should create pipeline run and update status', () => {
    // Create pipeline first (required for foreign key)
    db.createPipeline({
      id: 'pipeline-1',
      name: 'build-deploy',
      config_enc: JSON.stringify({ steps: ['build', 'deploy'] })
    });
    
    db.createPipelineRun({
      id: 'run-1',
      pipeline_id: 'pipeline-1',
      status: 'running'
    });
    
    db.updatePipelineRunStatus('run-1', 'success');
    
    const run = db.getPipelineRun('run-1');
    expect(run?.status).toBe('success');
  });

  it('should save and query metrics', () => {
    // Create server first (required for foreign key)
    db.createServer({
      id: 'server-1',
      name: 'prod-server',
      type: 'ssh',
      host: '192.168.1.100',
      port: 22,
      credentials_enc: 'encrypted-creds'
    });
    
    db.saveMetric({
      server_id: 'server-1',
      metric_name: 'node_cpu_usage_percent',
      metric_value: 75.5,
      labels: {
        instance: '192.168.1.100',
        job: 'qunkins'
      }
    });
    
    const metrics = db.getLatestMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].metric_value).toBe(75.5);
    expect(metrics[0].labels.instance).toBe('192.168.1.100');
  });
});
