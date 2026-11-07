import express from 'express';
import { errorHandler, notFoundHandler } from '../api/src/middleware/error.ts';
import { authRouter } from '../api/src/modules/auth/router.ts';
import { opsRouter } from '../api/src/modules/ops/router.ts';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/auth', authRouter);
app.use('/api/ops', opsRouter);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(8082, '127.0.0.1', () => {
  console.log('ops test server listening on http://127.0.0.1:8082');
});
