import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { prisma } from './prisma.js';

const host = process.env.HOST || '0.0.0.0';

const server = app.listen(config.port, host, () => {
  console.log(`Campus tracker API listening on http://${host}:${config.port}`);
  console.log(
    `Database: ${config.db.host}:${config.db.port}/${config.db.database} (NODE_ENV=${config.nodeEnv})`
  );
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
