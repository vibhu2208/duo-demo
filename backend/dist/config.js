import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
export const config = {
    port: parseInt(process.env.PORT || process.env.BACKEND_PORT || '3001', 10),
    databaseUrl: process.env.DATABASE_URL || 'postgresql://jira_ai:jira_ai_secret@localhost:5432/jira_intelligence',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:3002',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    jira: {
        baseUrl: process.env.JIRA_BASE_URL || '',
        // JIRA_USERNAME for internal Server/DC; JIRA_EMAIL kept for Cloud backwards compatibility
        username: process.env.JIRA_USERNAME || process.env.JIRA_EMAIL || '',
        apiToken: process.env.JIRA_API_TOKEN || '',
        projectKey: process.env.JIRA_PROJECT_KEY || '',
        // server = internal Jira Server/Data Center | cloud = Atlassian Cloud
        deploymentType: (process.env.JIRA_DEPLOYMENT || 'server'),
        // resolved | closed | both
        syncFilter: (process.env.JIRA_SYNC_FILTER || 'resolved'),
        // Set true for internal instances with self-signed TLS certificates
        insecureSsl: process.env.JIRA_INSECURE_SSL === 'true',
    },
    seed: {
        email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
        password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
    },
    github: {
        token: process.env.GITHUB_TOKEN || '',
        defaultOwner: process.env.GITHUB_DEFAULT_OWNER || '',
    },
};
