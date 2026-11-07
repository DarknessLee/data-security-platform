import cors from 'cors';
import express from 'express';
import { config } from './config/env.ts';
import { auditWriter } from './middleware/audit.ts';
import { errorHandler, notFoundHandler } from './middleware/error.ts';
import { apiRouter } from './routes/index.ts';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors({
    origin: [config.webOrigin, 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:4174'],
    credentials: true,
    exposedHeaders: ['X-Response-Time'],
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const cost = Date.now() - started;
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[api] ${req.method} ${req.originalUrl} ${res.statusCode} ${cost}ms`);
      }
    });
    next();
  });

  app.use(auditWriter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
