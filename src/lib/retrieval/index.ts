import "server-only";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadDeals } from "../deals";
import { loadStoreProfile } from "../profile";
import { documentForOffer } from "./document";
import type { DealDocument } from "./types";

type MetaRow = { value: string };
let database: Database.Database | undefined;
const indexSchemaVersion = "2";

function dbPath(): string {
  return process.env.PANTRY_SIGNAL_RETRIEVAL_DATABASE_PATH ?? path.join(process.cwd(), "data", "pantry-signal-retrieval.sqlite");
}

function db(): Database.Database {
  if (database) return database;
  mkdirSync(path.dirname(dbPath()), { recursive: true });
  database = new Database(dbPath());
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS deal_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deal_documents (
      ref TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL UNIQUE,
      retailer TEXT NOT NULL,
      source_updated_at TEXT,
      document_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deal_documents_retailer ON deal_documents(retailer);
    CREATE VIRTUAL TABLE IF NOT EXISTS deal_fts USING fts5(
      ref UNINDEXED,
      title,
      brand,
      description,
      category,
      concepts,
      tokenize = 'porter unicode61'
    );
  `);
  return database;
}

function sourceFingerprint(documents: DealDocument[]): string {
  return createHash("sha256")
    .update(documents.map((document) => JSON.stringify({
      offerId: document.offerId,
      sourceUpdatedAt: document.sourceUpdatedAt,
      title: document.title,
      identityText: document.identityText,
      concepts: document.concepts,
      promotionKind: document.promotionKind,
      salePrice: document.salePrice,
      discountAmount: document.discountAmount,
    })).sort().join("\n"))
    .digest("hex");
}

function meta(key: string): string | null {
  return (db().prepare("SELECT value FROM deal_index_meta WHERE key = ?").get(key) as MetaRow | undefined)?.value ?? null;
}

function writeMeta(key: string, value: string) {
  db().prepare("INSERT INTO deal_index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

async function currentSourceStamp(): Promise<string> {
  const profile = await loadStoreProfile();
  const publixCurrent = path.join(process.cwd(), "data", "publix", profile.publix.storeId, "current.json");
  const sources = [
    existsSync(publixCurrent) ? publixCurrent : path.join(process.cwd(), "publix", "response-example.json"),
    path.join(process.cwd(), "data", "costco", "current.json"),
    path.join(process.cwd(), "data", "wholefoods", "current.json"),
  ];
  return createHash("sha256")
    .update(JSON.stringify({
      indexSchemaVersion,
      publixStoreId: profile.publix.storeId,
      sources: sources.map((source) => existsSync(source) ? { source, size: statSync(source).size, mtimeMs: statSync(source).mtimeMs } : { source, missing: true }),
    }))
    .digest("hex");
}

export type IndexStatus = {
  version: string;
  documentCount: number;
  builtAt: string | null;
  sourceFreshness: Array<{ retailer: DealDocument["retailer"]; sourceUpdatedAt: string | null }>;
};

export async function rebuildDealIndex(): Promise<IndexStatus> {
  const sourceStamp = await currentSourceStamp();
  const offers = await loadDeals(await loadStoreProfile());
  const documents = offers.map(documentForOffer);
  const version = sourceFingerprint(documents);
  const existingVersion = meta("version");
  if (existingVersion === version && Number(meta("document_count")) === documents.length && meta("source_stamp") === sourceStamp) return indexStatus();

  const connection = db();
  const insertDocument = connection.prepare("INSERT INTO deal_documents (ref, offer_id, retailer, source_updated_at, document_json) VALUES (?, ?, ?, ?, ?)");
  const insertFts = connection.prepare("INSERT INTO deal_fts (ref, title, brand, description, category, concepts) VALUES (?, ?, ?, ?, ?, ?)");
  const replace = connection.transaction((nextDocuments: DealDocument[]) => {
    connection.exec("DELETE FROM deal_documents");
    connection.exec("DELETE FROM deal_fts");
    for (const document of nextDocuments) {
      insertDocument.run(document.ref, document.offerId, document.retailer, document.sourceUpdatedAt, JSON.stringify(document));
      insertFts.run(document.ref, document.title, document.brand ?? "", document.description, document.category, document.concepts.join(" "));
    }
    writeMeta("version", version);
    writeMeta("document_count", String(nextDocuments.length));
    writeMeta("built_at", new Date().toISOString());
    writeMeta("source_stamp", sourceStamp);
  });
  replace(documents);
  return indexStatus();
}

export async function ensureDealIndex(): Promise<IndexStatus> {
  if (meta("source_stamp") !== await currentSourceStamp()) return rebuildDealIndex();
  return indexStatus();
}

export function indexDocuments(): DealDocument[] {
  return (db().prepare("SELECT document_json FROM deal_documents").all() as Array<{ document_json: string }>)
    .map(({ document_json }) => JSON.parse(document_json) as DealDocument);
}

export function ftsMatches(query: string, limit: number): Array<{ ref: string; rank: number }> {
  if (!query.trim()) return [];
  try {
    return db().prepare("SELECT ref, bm25(deal_fts) AS rank FROM deal_fts WHERE deal_fts MATCH ? ORDER BY rank LIMIT ?")
      .all(query, limit) as Array<{ ref: string; rank: number }>;
  } catch {
    return [];
  }
}

export function indexStatus(): IndexStatus {
  const documents = indexDocuments();
  const freshness = new Map<DealDocument["retailer"], string | null>();
  for (const document of documents) {
    const current = freshness.get(document.retailer);
    if (!current || (document.sourceUpdatedAt && document.sourceUpdatedAt > current)) freshness.set(document.retailer, document.sourceUpdatedAt);
    if (!freshness.has(document.retailer)) freshness.set(document.retailer, document.sourceUpdatedAt);
  }
  return {
    version: meta("version") ?? "unbuilt",
    documentCount: documents.length,
    builtAt: meta("built_at"),
    sourceFreshness: [...freshness.entries()].map(([retailer, sourceUpdatedAt]) => ({ retailer, sourceUpdatedAt })).sort((a, b) => a.retailer.localeCompare(b.retailer)),
  };
}
