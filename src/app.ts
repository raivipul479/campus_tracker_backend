import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFound } from './errors.js';
import { router } from './routes/index.js';

export const app = express();
app.set('trust proxy', 1);
const allowedOrigins = [
  ...config.corsOrigin.split(',').map(origin => origin.trim()),
  'https://location-app-tfks.onrender.com',
  'https://location-app-1-61r2.onrender.com'
].filter(Boolean);
const isAllowedOrigin = (origin: string) => {
  if (allowedOrigins.includes(origin)) return true;
  if (config.isProduction) return false;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
};

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    // A localhost origin rejected in production mode is almost always someone
    // running the server locally with NODE_ENV=production, where .env.production
    // supplies CORS_ORIGIN and the localhost allowance above is switched off.
    // Say so, rather than leaving them to guess at the port.
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const hint = isLocalhost && config.isProduction
      ? ` — the server is running with NODE_ENV=production, which only allows CORS_ORIGIN from .env.production.` +
        ` For local development run "npm run dev" (or "npm start" for the compiled build) instead of "npm run start:prod".`
      : '';
    callback(new Error(`Origin ${origin} is not allowed by CORS${hint}`));
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use('/api', router);

app.use(notFound);
app.use(errorHandler);
