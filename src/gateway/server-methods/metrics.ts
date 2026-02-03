import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

function getDb(): SqliteDatabase | null {
  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const workspace =
      process.env.OPENCLAW_WORKSPACE ??
      join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace");
    const dbPath = join(workspace, "usage_costs.sqlite");
    if (!existsSync(dbPath)) return null;
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

function query(db: SqliteDatabase, sql: string): unknown[] {
  return db.prepare(sql).all();
}

function queryOne(db: SqliteDatabase, sql: string): Record<string, unknown> {
  const rows = db.prepare(sql).all();
  return (rows[0] as Record<string, unknown>) ?? {};
}

function daysClause(days: number | null): string {
  if (!days) return "";
  return `AND date(ts) >= date('now', '-${days} days')`;
}

export const metricsHandlers: GatewayRequestHandlers = {
  "metrics.overview": ({ params, respond }) => {
    const db = getDb();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Usage DB not found"));
      return;
    }

    const { days } = (params ?? {}) as { days?: number };
    const rangeDays = days ?? 14;
    const dailyDays = Math.min(rangeDays || 30, 90);

    try {
      const todayRow = queryOne(
        db,
        `SELECT COALESCE(SUM(cost_total), 0) as cost, COUNT(*) as events
         FROM usage_events WHERE date(ts) = date('now')`,
      );

      const yesterdayRow = queryOne(
        db,
        `SELECT COALESCE(SUM(cost_total), 0) as cost
         FROM usage_events WHERE date(ts) = date('now', '-1 day')`,
      );

      const avgRow = queryOne(
        db,
        `SELECT COALESCE(AVG(daily_cost), 0) as avg_cost FROM (
          SELECT date(ts) as d, SUM(cost_total) as daily_cost
          FROM usage_events WHERE date(ts) >= date('now', '-7 days')
          GROUP BY date(ts))`,
      );

      const rangeFilter = days ? `WHERE date(ts) >= date('now', '-${days} days')` : "";
      const totalRow = queryOne(
        db,
        `SELECT COALESCE(SUM(cost_total), 0) as cost, COUNT(*) as events,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
          SUM(cache_read) as cache_tokens
         FROM usage_events ${rangeFilter}`,
      );

      const byModel = query(
        db,
        `SELECT model, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
          SUM(cache_read) as cache_tokens
         FROM usage_events
         WHERE model NOT IN ('unknown', 'delivery-mirror') ${daysClause(days ?? null)}
         GROUP BY model ORDER BY cost DESC`,
      );

      const hourly = query(
        db,
        `SELECT hour_pt as hour, ROUND(SUM(cost_total), 4) as cost, COUNT(*) as events
         FROM usage_events
         WHERE ts >= datetime('now', '-48 hours')
         GROUP BY hour_pt ORDER BY hour_pt`,
      );

      const daily = query(
        db,
        `SELECT date(ts) as day, ROUND(SUM(cost_total), 4) as cost, COUNT(*) as events
         FROM usage_events
         WHERE date(ts) >= date('now', '-${dailyDays} days')
         GROUP BY date(ts) ORDER BY date(ts)`,
      );

      const topSessions = query(
        db,
        `SELECT session_key, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          MIN(ts) as first_event, MAX(ts) as last_event
         FROM usage_events
         WHERE session_key IS NOT NULL AND date(ts) >= date('now', '-1 day')
         GROUP BY session_key ORDER BY cost DESC LIMIT 10`,
      );

      db.close();

      const round2 = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;

      respond(true, {
        today: { cost: round2(todayRow.cost), events: Number(todayRow.events) },
        yesterday: { cost: round2(yesterdayRow.cost) },
        weekAvg: { cost: round2(avgRow.avg_cost) },
        allTime: {
          cost: round2(totalRow.cost),
          events: Number(totalRow.events),
          inputTokens: Number(totalRow.input_tokens),
          outputTokens: Number(totalRow.output_tokens),
          cacheTokens: Number(totalRow.cache_tokens),
        },
        byModel,
        hourly,
        daily,
        topSessions,
        days: days ?? null,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      try {
        db.close();
      } catch {}
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Metrics query failed: ${String(err)}`),
      );
    }
  },

  "metrics.modelDetail": ({ params, respond }) => {
    const db = getDb();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Usage DB not found"));
      return;
    }
    const { model, days } = params as { model?: string; days?: number };
    if (!model) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "model required"));
      return;
    }

    try {
      const rangeFilter = days ? `AND date(ts) >= date('now', '-${days} days')` : "";

      const summary = queryOne(
        db,
        `SELECT COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
          SUM(cache_read) as cache_tokens,
          ROUND(AVG(cost_total), 6) as avg_cost_per_event
         FROM usage_events WHERE model = '${model.replace(/'/g, "''")}' ${rangeFilter}`,
      );

      const daily = query(
        db,
        `SELECT date(ts) as day, ROUND(SUM(cost_total), 4) as cost, COUNT(*) as events
         FROM usage_events WHERE model = '${model.replace(/'/g, "''")}'
         AND date(ts) >= date('now', '-${days ?? 14} days')
         GROUP BY date(ts) ORDER BY date(ts)`,
      );

      const bySessions = query(
        db,
        `SELECT session_key, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost
         FROM usage_events WHERE model = '${model.replace(/'/g, "''")}'
         AND session_key IS NOT NULL ${rangeFilter}
         GROUP BY session_key ORDER BY cost DESC LIMIT 10`,
      );

      const hourly = query(
        db,
        `SELECT hour_pt as hour, ROUND(SUM(cost_total), 4) as cost, COUNT(*) as events
         FROM usage_events WHERE model = '${model.replace(/'/g, "''")}'
         AND ts >= datetime('now', '-48 hours')
         GROUP BY hour_pt ORDER BY hour_pt`,
      );

      db.close();

      respond(true, {
        model,
        summary,
        daily,
        hourly,
        bySessions,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      try {
        db.close();
      } catch {}
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Model detail query failed: ${String(err)}`),
      );
    }
  },

  "metrics.dayDetail": ({ params, respond }) => {
    const db = getDb();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Usage DB not found"));
      return;
    }
    const { day } = params as { day?: string };
    if (!day) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "day required (YYYY-MM-DD)"),
      );
      return;
    }

    try {
      const summary = queryOne(
        db,
        `SELECT COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
          SUM(cache_read) as cache_tokens
         FROM usage_events WHERE date(ts) = '${day.replace(/'/g, "''")}'`,
      );

      const byModel = query(
        db,
        `SELECT model, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE date(ts) = '${day.replace(/'/g, "''")}'
         AND model NOT IN ('unknown', 'delivery-mirror')
         GROUP BY model ORDER BY cost DESC`,
      );

      const byHour = query(
        db,
        `SELECT hour_pt as hour, ROUND(SUM(cost_total), 4) as cost, COUNT(*) as events
         FROM usage_events WHERE date(ts) = '${day.replace(/'/g, "''")}'
         GROUP BY hour_pt ORDER BY hour_pt`,
      );

      const bySessions = query(
        db,
        `SELECT session_key, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost
         FROM usage_events WHERE date(ts) = '${day.replace(/'/g, "''")}'
         AND session_key IS NOT NULL
         GROUP BY session_key ORDER BY cost DESC LIMIT 10`,
      );

      db.close();

      respond(true, {
        day,
        summary,
        byModel,
        byHour,
        bySessions,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      try {
        db.close();
      } catch {}
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Day detail query failed: ${String(err)}`),
      );
    }
  },
};
