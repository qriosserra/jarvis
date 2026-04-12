#!/usr/bin/env node
// db-reset.mjs: Drop and recreate the dev jarvis database, then re-run migrations.
// Usage: pnpm run db:reset
// Requires the jarvis-postgres-1 Docker container to be running.

import { execSync } from 'node:child_process';

const CONTAINER = 'jarvis-postgres-1';
const DB_USER = 'jarvis';
const DB_NAME = 'jarvis';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

console.log(`Dropping database "${DB_NAME}"…`);
run(`docker exec ${CONTAINER} psql -U ${DB_USER} -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"`);

console.log(`Creating database "${DB_NAME}"…`);
run(`docker exec ${CONTAINER} psql -U ${DB_USER} -d postgres -c "CREATE DATABASE ${DB_NAME};"`);

console.log('Running migrations…');
run('pnpm run db:migrate');
