import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFound } from './errors.js';
import { router } from './routes/index.js';

export const app = express();
const allowedOrigins = config.corsOrigin.split(',').map(origin => origin.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use('/api', router);

app.use(notFound);
app.use(errorHandler);
