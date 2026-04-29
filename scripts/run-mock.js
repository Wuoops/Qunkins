const BetterSqlite3 = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '../../data/qunkins.db');
const db = new BetterSqlite3(dbPath);
console.log('Generating mock data...');
const servers = db.prepare('SELECT * FROM servers').all();
const nowSeconds = Math.floor(Date.now() / 1000);
db.transaction(() => {
  for (const server of servers) {
    for (let i = 48; i >= 0; i--) {
      const timeSecs = nowSeconds - (i * 1800);
      db.prepare('INSERT INTO server_metrics (server_id, metric_name, metric_value, collected_at) VALUES (?, ?, ?, ?)').run(server.id, 'cpu_usage', Math.round(Math.random() * 40 + 10), timeSecs);
      db.prepare('INSERT INTO server_metrics (server_id, metric_name, metric_value, collected_at) VALUES (?, ?, ?, ?)').run(server.id, 'memory_usage', Math.round(Math.random() * 30 + 40), timeSecs);
    }
  }
})();
console.log('Mock data generated');