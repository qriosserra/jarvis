import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL ?? 'postgresql://jarvis:jarvis@localhost:5432/jarvis';
const pool = new Pool({ connectionString: url });

runMigrations(pool)
  .then(() => {
    console.log('Migrations complete');
    return pool.end();
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
