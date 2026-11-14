import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { get } from "@vercel/blob";
import { normalizePublixSnapshot } from "./normalize";
import { normalizeCostcoResponse } from "./costco";
import { normalizeWholeFoodsResponse } from "./wholefoods";
import type { Offer, Retailer, RawPublixProductSnapshot } from "./types";

export type CheckSource = {
  retailer: Retailer;
  store: string;
  latestSourceUpdate: string | null;
  stale: boolean;
  state: "available" | "fallback" | "unavailable";
  warnings: string[];
};
export type CheckCatalog = { offers: Offer[]; sources: CheckSource[] };
export type SnapshotReader = (pathname: string, origin: "blob" | "local") => Promise<unknown>;
const readSnapshot: SnapshotReader = async (pathname, origin) => {
  if (origin === "local") return JSON.parse(await readFile(path.join(process.cwd(), pathname), "utf8"));
  const blob = await get(pathname, { access: "private", useCache: false });
  if (blob?.statusCode !== 200) throw new Error("Snapshot unavailable");
  return new Response(blob.stream).json();
};

function normalize(raw: unknown, retailer: Retailer, store: string) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid snapshot");
  const data = raw as Record<string, unknown>;
  let offers: Offer[];
  let timestamp = data.retrievedAt;
  if (retailer === "publix") {
    if (data.storeId !== undefined && String(data.storeId) !== store) throw new Error("Store mismatch");
    const promotions = data.promotions as { Savings?: unknown; WeeklyAdLatestUpdatedDateTime?: string } | undefined;
    if (!Array.isArray(data.products) && !Array.isArray(promotions?.Savings) && !Array.isArray(data.Savings)) throw new Error("Invalid Publix snapshot");
    timestamp ??= promotions?.WeeklyAdLatestUpdatedDateTime ?? data.WeeklyAdLatestUpdatedDateTime;
    const snapshot = Array.isArray(data.Savings) ? { promotions: data } : data;
    offers = normalizePublixSnapshot(snapshot as RawPublixProductSnapshot, store);
  } else if (retailer === "costco") {
    if (!Array.isArray(data.categories) || !data.categories.every(c => c && typeof c === "object" && Array.isArray(c.deals))) throw new Error("Invalid Costco snapshot");
    offers = normalizeCostcoResponse(raw as Parameters<typeof normalizeCostcoResponse>[0]);
  } else {
    if (!Array.isArray(data.deals)) throw new Error("Invalid Whole Foods snapshot");
    offers = normalizeWholeFoodsResponse(raw as Parameters<typeof normalizeWholeFoodsResponse>[0]);
  }
  if (offers.some(o => !o.title || !o.source.offerId)) throw new Error("Invalid offer identity");
  const milliseconds = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  return { offers, timestamp: Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null };
}

/** Independent source reads with explicit provenance; never uses the Publix example fixture. */
export async function loadDealCheckCatalog(store: string, options: {
  now?: Date; reader?: SnapshotReader; useBlob?: boolean;
} = {}): Promise<CheckCatalog> {
  const now = options.now ?? new Date();
  const reader = options.reader ?? readSnapshot;
  const useBlob = options.useBlob ?? Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const specs: Array<{ retailer: Retailer; store: string; pathname: string }> = [
    { retailer: "publix", store, pathname: `data/publix/${store}/current.json` },
    { retailer: "costco", store: "warehouse-savings", pathname: "data/costco/current.json" },
    { retailer: "wholefoods", store: "all-deals", pathname: "data/wholefoods/current.json" },
  ];
  const results = await Promise.all(specs.map(async spec => {
    const warnings: string[] = [];
    for (const origin of (useBlob ? ["blob", "local"] : ["local"]) as Array<"blob" | "local">) {
      try {
        const result = normalize(await reader(spec.pathname, origin), spec.retailer, spec.store);
        const stale = result.timestamp === null || now.getTime() - Date.parse(result.timestamp) > 26 * 60 * 60 * 1000;
        if (stale) warnings.push("Source is older than 26 hours or its update time is unknown.");
        const source: CheckSource = { retailer: spec.retailer, store: spec.store, latestSourceUpdate: result.timestamp,
          stale, state: warnings.length && origin === "local" && useBlob ? "fallback" : "available", warnings };
        return { offers: result.offers, source };
      } catch {
        warnings.push(origin === "blob" ? "Remote snapshot unavailable or invalid; trying bundled data." : "Bundled snapshot unavailable, invalid, or for a different store.");
      }
    }
    const source: CheckSource = { retailer: spec.retailer, store: spec.store, latestSourceUpdate: null, stale: true, state: "unavailable", warnings };
    return { offers: [] as Offer[], source };
  }));
  return { offers: results.flatMap(r => r.offers), sources: results.map(r => r.source) };
}
