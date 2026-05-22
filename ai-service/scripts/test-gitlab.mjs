import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const userUrl = `${process.env.GITLAB_URL}/api/v4/user`;
const userCheck = await axios.get(userUrl, {
  headers: { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN },
  timeout: 10000,
  validateStatus: () => true,
});
console.log('USER API', userCheck.status, userCheck.data?.username || userCheck.data?.message);

const url = `${process.env.GITLAB_URL}/api/v4/chat/completions`;
try {
  const r = await axios.post(
    url,
    { content: 'Say hello', with_clean_history: true },
    {
      headers: {
        Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
      validateStatus: () => true,
    }
  );
  console.log('STATUS', r.status);
  console.log('DATA', JSON.stringify(r.data).slice(0, 500));
} catch (e) {
  console.log('ERR', e.code, e.message);
  if (e.response) {
    console.log('STATUS', e.response.status);
    console.log('DATA', JSON.stringify(e.response.data).slice(0, 500));
  }
}
