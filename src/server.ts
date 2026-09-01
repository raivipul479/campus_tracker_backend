import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { prisma } from './prisma.js';
import { GpsPoller } from './services/gps-poller.service.js';

const host = process.env.HOST || '0.0.0.0';

const server = app.listen(config.port, host, () => {
  console.log(`Campus tracker API listening on http://${host}:${config.port}`);
  console.log(
    `Database: ${config.db.host}:${config.db.port}/${config.db.database} (NODE_ENV=${config.nodeEnv})`
  );

  // One writer for GPS: client reads come from the database, so the
  // provider's one-call-per-minute limit never reaches them.
  GpsPoller.start();
});

const shutdown = async () => {
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
