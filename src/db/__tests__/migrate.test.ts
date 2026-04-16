import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { runMigrations } from '../migrate.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);

// ── Helpers ────────────────────────────────────────────────────────
function createMockPool(appliedNames: string[] = []) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];

  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });

      // Return applied migration names for the SELECT query
      if (typeof text === 'string' && text.includes('SELECT name FROM _migration')) {
        return { rows: appliedNames.map((name) => ({ name })) } as unknown as QueryResult;
      }

      return { rows: [], command: '', rowCount: 0, oid: 0, fields: [] } as unknown as QueryResult;
    }),
  } as unknown as Pool;

  return { pool, queries };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('schema-file path', () => {
    it('applies schema.sql and records marker on fresh database', async () => {
      const { pool, queries } = createMockPool([]);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('schema.sql') ? true : false,
      );
      mockReadFile.mockResolvedValue('CREATE TABLE test();');

      await runMigrations(pool);

      // Should read schema.sql
      expect(mockReadFile).toHaveBeenCalledTimes(1);
      expect(String(mockReadFile.mock.calls[0][0])).toContain('schema.sql');

      // Should wrap in transaction and insert marker
      const texts = queries.map((q) => q.text);
      expect(texts).toContain('BEGIN');
      expect(texts).toContain('COMMIT');
      expect(queries.some((q) => q.values?.[0] === 'schema.sql')).toBe(true);
    });

    it('skips when schema.sql marker is already applied', async () => {
      const { pool } = createMockPool(['schema.sql']);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('schema.sql') ? true : false,
      );

      await runMigrations(pool);

      // Should not read any files
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('throws when schema.sql exists but numbered migrations already applied', async () => {
      const { pool } = createMockPool(['001-initial.sql']);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('schema.sql') ? true : false,
      );

      await expect(runMigrations(pool)).rejects.toThrow(
        /Cannot apply schema\.sql.*numbered migration history/,
      );
    });

    it('rolls back on schema.sql application failure', async () => {
      const failPool = {
        query: vi.fn(async (text: string) => {
          if (typeof text === 'string' && text.includes('SELECT name FROM _migration')) {
            return { rows: [] };
          }
          if (typeof text === 'string' && text === 'CREATE TABLE fail();') {
            throw new Error('syntax error');
          }
          return { rows: [] };
        }),
      } as unknown as Pool;

      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('schema.sql') ? true : false,
      );
      mockReadFile.mockResolvedValue('CREATE TABLE fail();');

      await expect(runMigrations(failPool)).rejects.toThrow('syntax error');
      expect(failPool.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('numbered-migration fallback', () => {
    it('applies numbered migrations when schema.sql is absent', async () => {
      const { pool, queries } = createMockPool([]);
      mockExistsSync.mockImplementation((p) => {
        if (String(p).endsWith('schema.sql')) return false;
        // migrations dir exists
        return true;
      });
      mockReaddir.mockResolvedValue(['001-init.sql', '002-seed.sql'] as any);
      mockReadFile.mockResolvedValue('SELECT 1;');

      await runMigrations(pool);

      // Should read both migration files
      expect(mockReadFile).toHaveBeenCalledTimes(2);

      // Should record both filenames
      const insertQueries = queries.filter(
        (q) => q.text.includes('INSERT INTO _migration') && q.values,
      );
      expect(insertQueries).toHaveLength(2);
      expect(insertQueries[0].values?.[0]).toBe('001-init.sql');
      expect(insertQueries[1].values?.[0]).toBe('002-seed.sql');
    });

    it('skips already-applied numbered migrations', async () => {
      const { pool } = createMockPool(['001-init.sql']);
      mockExistsSync.mockImplementation((p) => {
        if (String(p).endsWith('schema.sql')) return false;
        return true;
      });
      mockReaddir.mockResolvedValue(['001-init.sql', '002-seed.sql'] as any);
      mockReadFile.mockResolvedValue('SELECT 1;');

      await runMigrations(pool);

      // Only the unapplied migration should be read
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('throws when neither schema.sql nor migrations dir exist', async () => {
      const { pool } = createMockPool([]);
      mockExistsSync.mockReturnValue(false);

      await expect(runMigrations(pool)).rejects.toThrow(
        /Neither schema\.sql nor migrations directory found/,
      );
    });
  });
});
