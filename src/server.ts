import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { prisma } from './prisma.js';

const server = app.listen(config.port, () => {
  console.log(`Campus tracker API listening on http://localhost:${config.port}`);
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
