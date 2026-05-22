import pg from 'pg';
import { config } from '../config.js';

const useSsl =
  config.databaseUrl.includes('neon.tech') ||
  config.databaseUrl.includes('sslmode=require');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}
