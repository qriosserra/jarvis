import type { Pool } from 'pg';
import type { Persona } from '../types.js';

const COLUMNS = `id, name, description, system_prompt AS "systemPrompt",
  response_style AS "responseStyle", is_default AS "isDefault",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export class PersonaRepo {
  constructor(private pool: Pool) {}

  async create(data: {
    name: string;
    description?: string;
    systemPrompt: string;
    responseStyle?: Record<string, unknown>;
    isDefault?: boolean;
  }): Promise<Persona> {
    const { rows } = await this.pool.query<Persona>(
      `INSERT INTO personas (name, description, system_prompt, response_style, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [
        data.name,
        data.description ?? null,
        data.systemPrompt,
        JSON.stringify(data.responseStyle ?? {}),
        data.isDefault ?? false,
      ],
    );
    return rows[0];
  }

  async findByName(name: string): Promise<Persona | null> {
    const { rows } = await this.pool.query<Persona>(
      `SELECT ${COLUMNS} FROM personas WHERE name = $1`,
      [name],
    );
    return rows[0] ?? null;
  }

  async findDefault(): Promise<Persona | null> {
    const { rows } = await this.pool.query<Persona>(
      `SELECT ${COLUMNS} FROM personas WHERE is_default = true LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  async list(): Promise<Persona[]> {
    const { rows } = await this.pool.query<Persona>(
      `SELECT ${COLUMNS} FROM personas ORDER BY name`,
    );
    return rows;
  }
}
