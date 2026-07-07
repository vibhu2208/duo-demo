import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import authRoutes from './routes/auth.routes.js';
import jiraRoutes from './routes/jira.routes.js';
import ticketsRoutes from './routes/tickets.routes.js';
import chatRoutes from './routes/chat.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import aiRoutes from './routes/ai.routes.js';
import gitlabCodeRoutes from './routes/gitlab-code.routes.js';
import githubCodeRoutes from './routes/github-code.routes.js';

const app = express();

app.use(helmet());
app.use(morgan('dev'));
app.use(
  cors({
    origin: [config.frontendUrl, 'http://localhost:5173'],
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/jira', jiraRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/gitlab', gitlabCodeRoutes);
app.use('/api/github', githubCodeRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});
