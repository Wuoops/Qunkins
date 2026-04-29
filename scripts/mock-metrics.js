const BetterSqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/qunkins.db');
const db = new BetterSqlite3(dbPath);

console.log('Generating 24 hours of mock metric data...');

const servers = db.prepare('SELECT * FROM servers').all();

if (servers.length === 0) {
  console.log('No servers found. Please add a server first.');
  process.exit(0);
}

const nowSeconds = Math.floor(Date.now() / 1000);
const intervals = 48; // 24 hours * 2 (every 30 mins)

db.transaction(() => {
  for (const server of servers) {
    for (let i = intervals; i >= 0; i--) {
      const timeSecs = nowSeconds - (i * 1800);
      
      const cpu = Math.round(Math.random() * 40 + 10);
      const memory = Math.round(Math.random() * 30 + 40);
      
      db.prepare(
        'INSERT INTO server_metrics (server_id, metric_name, metric_value, collected_at) VALUES (?, ?, ?, ?)'
      ).run(server.id, 'cpu_usage', cpu, timeSecs);
      
      db.prepare(
        'INSERT INTO server_metrics (server_id, metric_name, metric_value, collected_at) VALUES (?, ?, ?, ?)'
      ).run(server.id, 'memory_usage', memory, timeSecs);
      
      db.prepare(
        'INSERT INTO server_metrics (server_id, metric_name, metric_value, collected_at) VALUES (?, ?, ?, ?)'
      ).run(server.id, 'disk_usage', 65, timeSecs);
    }
  }
})();

console.log('Mock data generation complete!');
