import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(schema);
  console.log('Schema applied.');

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [config.seed.email]);
  if (rows.length === 0) {
    const hash = await bcrypt.hash(config.seed.password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')`,
      [config.seed.email, hash, 'Admin User']
    );
    console.log(`Seeded admin: ${config.seed.email}`);
  }

  await pool.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
