import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { gitlabChatViaGraphql } = await import('../dist/lib/llm/gitlab-graphql.js');

console.log('Testing GitLab Duo GraphQL chat (may take up to 60s)...');
try {
  const answer = await gitlabChatViaGraphql('Reply with exactly: OK', 'OK');
  console.log('SUCCESS:', answer.slice(0, 300));
} catch (e) {
  console.error('FAILED:', e.message);
}
