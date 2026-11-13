import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { dealSnapshotPaths, readDealSnapshot } from "./deal-snapshot-store";
import { normalizeCostcoResponse } from "./costco";
import { normalizePublixSnapshot } from "./normalize";
import { loadStoreProfile } from "./profile";
import type { StoreProfile } from "./profile-types";
import type { Offer, RawPublixProductSnapshot, RawPublixResponse } from "./types";
import { normalizeWholeFoodsResponse } from "./wholefoods";

function sourcePath(storeId: string) {
  const refreshed = path.join(process.cwd(), "data", "publix", storeId, "current.json");
  return existsSync(refreshed) ? refreshed : path.join(process.cwd(), "publix", "response-example.json");
}

export async function loadPublixDeals(profile?: StoreProfile): Promise<Offer[]> {
  const selectedProfile = profile ?? await loadStoreProfile();
  const storeId = process.env.PUBLIX_STORE_ID ?? selectedProfile.publix.storeId;
  const raw = await readDealSnapshot<RawPublixResponse | RawPublixProductSnapshot>(dealSnapshotPaths.publix(storeId), sourcePath(storeId));
  if ("Savings" in raw) return normalizePublixSnapshot({ promotions: raw }, storeId);
  return normalizePublixSnapshot(raw, storeId);
}

export async function loadCostcoDeals(): Promise<Offer[]> {
  const source = path.join(process.cwd(), "data", "costco", "current.json");
  if (!existsSync(source)) return [];
  return normalizeCostcoResponse(await readDealSnapshot(dealSnapshotPaths.costco, source));
}

export async function loadWholeFoodsDeals(): Promise<Offer[]> {
  const source = path.join(process.cwd(), "data", "wholefoods", "current.json");
  if (!existsSync(source)) return [];
  return normalizeWholeFoodsResponse(await readDealSnapshot(dealSnapshotPaths.wholeFoods, source));
}

export async function loadDeals(profile?: StoreProfile): Promise<Offer[]> {
  const [publix, costco, wholeFoods] = await Promise.all([loadPublixDeals(profile), loadCostcoDeals(), loadWholeFoodsDeals()]);
  return [...publix, ...costco, ...wholeFoods];
}

export function isActive(offer: Offer, now = new Date()): boolean {
  if (offer.startsAt && new Date(offer.startsAt) > now) return false;
  // Costco's weekly-savings source does not publish a date for most offers.
  // The record is shown as current until its next refresh; it is never presented
  // as having a fabricated expiration date.
  return !offer.endsAt || now <= new Date(offer.endsAt);
}
