import type { Pool } from 'pg';
import type { User } from '../types.js';

const COLUMNS = `id, username, created_at AS "createdAt", updated_at AS "updatedAt"`;

export class UserRepo {
  constructor(private pool: Pool) {}

  async upsert(data: { id: string; username: string }): Promise<User> {
    const { rows } = await this.pool.query<User>(
      `INSERT INTO "user" (id, username)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET username = $2, updated_at = now()
       RETURNING ${COLUMNS}`,
      [data.id, data.username],
    );
    return rows[0];
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<User>(
      `SELECT ${COLUMNS} FROM "user" WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
}
