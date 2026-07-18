import type { Bindings } from "../env";

export class RateLimitShard implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, env: Bindings) {
    void env;
    this.state = state;
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS runtime_probe (
        probe_key TEXT PRIMARY KEY,
        checked_at INTEGER NOT NULL
      )
    `);
  }

  fetch(request: Request): Response {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/__runtime-probe") {
      return new Response("Not Found", { status: 404 });
    }

    const checkedAt = Date.now();
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO runtime_probe (probe_key, checked_at) VALUES (?, ?)`,
      "sqlite",
      checkedAt,
    );
    const row = this.state.storage.sql
      .exec<{ checked_at: number }>(
        `SELECT checked_at FROM runtime_probe WHERE probe_key = ?`,
        "sqlite",
      )
      .one();

    return Response.json({ sqlite: row.checked_at === checkedAt });
  }
}
