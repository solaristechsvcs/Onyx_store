'use strict';
const express = require('express');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, 'config.js');
if (!fs.existsSync(configPath)) {
  console.error('Missing config.js. Copy config.example.js to config.js and configure your Wisp port and MySQL credentials.');
  process.exit(1);
}
const config = require(configPath);
const port = Number(config.server?.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('config.server.port must be a valid TCP port (1-65535)');
}
const host = config.server?.host || '0.0.0.0';
const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port || 3306,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: config.mysql.connectionLimit || 10
});
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (_err) {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});
app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onyx Store</title></head><body><main><h1>Onyx Store</h1><p>Storefront setup is in progress.</p></main></body></html>'));
const server = app.listen(port, host, () => console.log(`Onyx Store listening on ${host}:${port}`));
async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
