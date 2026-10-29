import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

export type Role = "anon" | "authenticated" | "service_role";
export type Row = Record<string, unknown>;

export type Session = {
  /** Runs the query and returns the rows. */
  query: <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Returns the number of affected rows. */
  run: (sql: string, params?: unknown[]) => Promise<number>;
};

/**
 * In-memory Postgres with the real migration files loaded.
 * With `as(...)` requests run with a given role and user identity, as PostgREST does.
 */
export class TestDb {
  private constructor(private readonly pg: PGlite) {}

  /** If `migrationCount` is given only the first N migration files are applied (to test intermediate states). */
  static async create(options: { migrationCount?: number } = {}): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(await readFile(path.join(ROOT, "tests", "helpers", "supabase-shim.sql"), "utf8"));
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .slice(0, options.migrationCount);
    for (const file of files) {
      try {
        await pg.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration uygulanamadı: ${file}\n${(error as Error).message}`);
      }
    }
    return new TestDb(pg);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }

  /** Runs as superuser (without RLS); only for preparing test data. */
  async admin<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pg.query<T>(sql, params);
    return result.rows;
  }

  /** Runs an SQL script with multiple statements (e.g. a migration file) as superuser. */
  async adminScript(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  private sessionFor(tx: Transaction): Session {
    return {
      query: async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows,
      run: async (sql, params = []) => (await tx.query(sql, params)).affectedRows ?? 0,
    };
  }

  /**
   * Runs inside a single transaction with the given role and user identity.
   * On error the transaction is rolled back and the error is rethrown. `aal`: the session's assurance level (a session with
   * two-factor authentication is "aal2"; since migration 15 staff permissions require it).
   */
  async as<T>(role: Role, userId: string | null, fn: (session: Session) => Promise<T>, aal: "aal1" | "aal2" = "aal2"): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      const claims = userId ? { sub: userId, role, aal } : { role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${role}`);
      return fn(this.sessionFor(tx));
    }) as Promise<T>;
  }

  /** A signed-in user (by default a session with two-factor authentication). */
  asUser<T>(userId: string, fn: (session: Session) => Promise<T>): Promise<T> {
    return this.as("authenticated", userId, fn);
  }

  /** A session signed in with a password only, before the verification code was entered. */
  asUserWithoutMfa<T>(userId: string, fn: (session: Session) => Promise<T>): Promise<T> {
    return this.as("authenticated", userId, fn, "aal1");
  }

  asAnon<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    return this.as("anon", null, fn);
  }

  asService<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    return this.as("service_role", null, fn);
  }

  /** Inserts into auth.users (as Supabase Auth does); the profile is created by a trigger. */
  async createUser(email: string, meta: Row = {}): Promise<string> {
    const rows = await this.admin<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
      [email, JSON.stringify(meta)],
    );
    return rows[0]!.id;
  }

  /** Makes the user staff; `isAdmin`: admin (migration 18). */
  async makeStaff(userId: string, isActive = true, isAdmin = false): Promise<void> {
    await this.admin("update public.profiles set role = 'staff', is_active = $2, is_admin = $3 where id = $1", [userId, isActive, isAdmin]);
  }
}

/** Returns the error text to verify that an operation was rejected by the database. */
export async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("İşlemin reddedilmesi bekleniyordu ama başarılı oldu.");
}
