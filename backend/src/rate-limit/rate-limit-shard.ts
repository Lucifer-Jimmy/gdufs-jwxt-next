import { DurableObject } from "cloudflare:workers";

export class RateLimitShard extends DurableObject<Bindings> {
  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS runtime_probe (
        probe_key TEXT PRIMARY KEY,
        checked_at INTEGER NOT NULL
      )
    `);
  }

  override fetch(request: Request): Response {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/__runtime-probe") {
      return new Response("Not Found", { status: 404 });
    }

    const checkedAt = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO runtime_probe (probe_key, checked_at) VALUES (?, ?)`,
      "sqlite",
      checkedAt,
    );
    const row = this.ctx.storage.sql
      .exec<{ checked_at: number }>(
        `SELECT checked_at FROM runtime_probe WHERE probe_key = ?`,
        "sqlite",
      )
      .one();

    return Response.json({ sqlite: row.checked_at === checkedAt });
  }
}
