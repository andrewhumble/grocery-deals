import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { groceryLines } from "./match";
import { matchGroceryItemFromIndex } from "./retrieval/list-match";
import type { GroceryMatch, Offer } from "./types";

export type ListSnapshotInput = {
  source: string;
  sourceRef?: string;
  sourceTitle?: string;
  rawText: string;
  capturedAt?: string;
};

export type ListSnapshot = {
  id: string;
  source: string;
  sourceRef: string | null;
  sourceTitle: string | null;
  rawText: string;
  contentHash: string;
  capturedAt: string;
  createdAt: string;
};

export type ListItem = { id: string; position: number; rawText: string };
export type MatchRun = { id: string; snapshotId: string; createdAt: string; results: Array<{ item: ListItem; matches: GroceryMatch[] }> };

let database: DatabaseSync | undefined;

function db(): DatabaseSync {
  if (database) return database;
  const directory = path.join(process.cwd(), "data");
  mkdirSync(directory, { recursive: true });
  database = new DatabaseSync(process.env.PANTRY_SIGNAL_DATABASE_PATH ?? path.join(directory, "pantry-signal.sqlite"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS list_snapshots (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT '',
      source_title TEXT,
      raw_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(source, source_ref, content_hash)
    );
    CREATE TABLE IF NOT EXISTS list_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES list_snapshots(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      raw_text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS match_runs (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES list_snapshots(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS list_matches (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES match_runs(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      match_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS list_items_snapshot_position ON list_items(snapshot_id, position);
    CREATE INDEX IF NOT EXISTS match_runs_snapshot_created ON match_runs(snapshot_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS list_matches_run_position ON list_matches(run_id, position);
  `);
  return database;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isoDate(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function snapshotFromRow(row: Record<string, unknown>): ListSnapshot {
  return {
    id: String(row.id),
    source: String(row.source),
    sourceRef: row.source_ref ? String(row.source_ref) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    rawText: String(row.raw_text),
    contentHash: String(row.content_hash),
    capturedAt: String(row.captured_at),
    createdAt: String(row.created_at),
  };
}

export function validateListSnapshot(value: unknown): ListSnapshotInput {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = text(candidate.source, 80);
  const rawText = text(candidate.rawText, 20_000);
  if (!/^[a-zA-Z0-9_.-]+$/.test(source)) throw new Error("source must use letters, numbers, dots, underscores, or hyphens.");
  if (!rawText) throw new Error("rawText is required.");
  if (groceryLines(rawText).length === 0) throw new Error("No grocery-list items were found.");
  return {
    source,
    sourceRef: text(candidate.sourceRef, 240) || undefined,
    sourceTitle: text(candidate.sourceTitle, 240) || undefined,
    rawText,
    capturedAt: isoDate(candidate.capturedAt),
  };
}

export function createListSnapshot(input: ListSnapshotInput): { snapshot: ListSnapshot; items: ListItem[]; existing: boolean } {
  const database = db();
  const sourceRef = input.sourceRef ?? "";
  const contentHash = createHash("sha256").update(input.rawText).digest("hex");
  const existing = database.prepare("SELECT * FROM list_snapshots WHERE source = ? AND source_ref = ? AND content_hash = ?").get(input.source, sourceRef, contentHash) as Record<string, unknown> | undefined;
  if (existing) return { snapshot: snapshotFromRow(existing), items: listItems(String(existing.id)), existing: true };

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const lines = groceryLines(input.rawText);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO list_snapshots (id, source, source_ref, source_title, raw_text, content_hash, captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.source, sourceRef, input.sourceTitle ?? null, input.rawText, contentHash, input.capturedAt ?? createdAt, createdAt);
    const insertItem = database.prepare("INSERT INTO list_items (id, snapshot_id, position, raw_text) VALUES (?, ?, ?, ?)");
    const items = lines.map((rawText, position) => {
      const item = { id: randomUUID(), position, rawText };
      insertItem.run(item.id, id, position, rawText);
      return item;
    });
    database.exec("COMMIT");
    return { snapshot: { id, source: input.source, sourceRef: input.sourceRef ?? null, sourceTitle: input.sourceTitle ?? null, rawText: input.rawText, contentHash, capturedAt: input.capturedAt ?? createdAt, createdAt }, items, existing: false };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listItems(snapshotId: string): ListItem[] {
  return (db().prepare("SELECT id, position, raw_text FROM list_items WHERE snapshot_id = ? ORDER BY position").all(snapshotId) as Record<string, unknown>[])
    .map((row) => ({ id: String(row.id), position: Number(row.position), rawText: String(row.raw_text) }));
}

export function getListSnapshot(snapshotId: string): { snapshot: ListSnapshot; items: ListItem[] } | null {
  const row = db().prepare("SELECT * FROM list_snapshots WHERE id = ?").get(snapshotId) as Record<string, unknown> | undefined;
  return row ? { snapshot: snapshotFromRow(row), items: listItems(snapshotId) } : null;
}

export function listSnapshots(): Array<Omit<ListSnapshot, "rawText"> & { itemCount: number }> {
  return (db().prepare(`SELECT s.id, s.source, s.source_ref, s.source_title, s.content_hash, s.captured_at, s.created_at, COUNT(i.id) AS item_count
    FROM list_snapshots s LEFT JOIN list_items i ON i.snapshot_id = s.id GROUP BY s.id ORDER BY s.created_at DESC`).all() as Record<string, unknown>[])
    .map((row) => ({ id: String(row.id), source: String(row.source), sourceRef: row.source_ref ? String(row.source_ref) : null, sourceTitle: row.source_title ? String(row.source_title) : null, contentHash: String(row.content_hash), capturedAt: String(row.captured_at), createdAt: String(row.created_at), itemCount: Number(row.item_count) }));
}

export async function createMatchRun(snapshotId: string, offers: Offer[]): Promise<MatchRun | null> {
  const snapshot = getListSnapshot(snapshotId);
  if (!snapshot) return null;
  const database = db();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const results = await Promise.all(snapshot.items.map(async (item) => ({ item, matches: await matchGroceryItemFromIndex(item.rawText, offers) })));
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO match_runs (id, snapshot_id, created_at) VALUES (?, ?, ?)").run(id, snapshotId, createdAt);
    const insertMatch = database.prepare("INSERT INTO list_matches (id, run_id, item_id, position, match_json) VALUES (?, ?, ?, ?, ?)");
    for (const result of results) insertMatch.run(randomUUID(), id, result.item.id, result.item.position, JSON.stringify(result.matches));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { id, snapshotId, createdAt, results };
}

export function latestMatchRun(snapshotId: string): MatchRun | null {
  const run = db().prepare("SELECT id, snapshot_id, created_at FROM match_runs WHERE snapshot_id = ? ORDER BY created_at DESC LIMIT 1").get(snapshotId) as Record<string, unknown> | undefined;
  if (!run) return null;
  const rows = db().prepare(`SELECT i.id AS item_id, i.position, i.raw_text, m.match_json FROM list_matches m
    JOIN list_items i ON i.id = m.item_id WHERE m.run_id = ? ORDER BY m.position`).all(String(run.id)) as Record<string, unknown>[];
  return {
    id: String(run.id), snapshotId: String(run.snapshot_id), createdAt: String(run.created_at),
    results: rows.map((row) => ({ item: { id: String(row.item_id), position: Number(row.position), rawText: String(row.raw_text) }, matches: JSON.parse(String(row.match_json)) as GroceryMatch[] })),
  };
}
