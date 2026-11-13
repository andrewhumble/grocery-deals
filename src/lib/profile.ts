import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultStoreProfile, type SourceStatus, type StoreProfile } from "./profile-types";

const profilePath = path.join(process.cwd(), "data", "profile.json");

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function sanitizeStoreProfile(value: unknown): StoreProfile {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const publix = candidate.publix && typeof candidate.publix === "object" ? candidate.publix as Record<string, unknown> : {};
  const costco = candidate.costco && typeof candidate.costco === "object" ? candidate.costco as Record<string, unknown> : {};
  const wholeFoods = candidate.wholeFoods && typeof candidate.wholeFoods === "object" ? candidate.wholeFoods as Record<string, unknown> : {};
  const storeId = cleanText(publix.storeId, 10);
  const warehouseId = cleanText(costco.warehouseId, 40);
  const postalCode = cleanText(wholeFoods.postalCode, 10);

  return {
    publix: { storeId: /^\d+$/.test(storeId) ? storeId : defaultStoreProfile.publix.storeId },
    costco: { warehouseId: /^[a-zA-Z0-9 -]*$/.test(warehouseId) ? warehouseId : "", label: cleanText(costco.label, 80) },
    wholeFoods: { postalCode: /^(\d{5}(-\d{4})?)?$/.test(postalCode) ? postalCode : "", label: cleanText(wholeFoods.label, 80) },
  };
}

export async function loadStoreProfile(): Promise<StoreProfile> {
  if (!existsSync(profilePath)) return defaultStoreProfile;
  try {
    return sanitizeStoreProfile(JSON.parse(await readFile(profilePath, "utf8")));
  } catch {
    return defaultStoreProfile;
  }
}

export async function saveStoreProfile(value: unknown): Promise<StoreProfile> {
  const profile = sanitizeStoreProfile(value);
  await mkdir(path.dirname(profilePath), { recursive: true });
  const temporary = `${profilePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`);
  await rename(temporary, profilePath);
  return profile;
}

async function sourceStatus(retailer: SourceStatus["retailer"], label: string, source: string, detail: string): Promise<SourceStatus> {
  if (!existsSync(source)) return { retailer, label, refreshedAt: null, detail: "No source data has been fetched yet." };
  const info = await stat(source);
  return { retailer, label, refreshedAt: info.mtime.toISOString(), detail };
}

export async function loadSourceStatuses(profile: StoreProfile): Promise<SourceStatus[]> {
  const publixCurrent = path.join(process.cwd(), "data", "publix", profile.publix.storeId, "current.json");
  const publixFixture = path.join(process.cwd(), "publix", "response-example.json");
  const publixSource = existsSync(publixCurrent) ? publixCurrent : publixFixture;
  return Promise.all([
    sourceStatus("publix", "Publix", publixSource, existsSync(publixCurrent) ? `Store ${profile.publix.storeId}` : "Example fixture — refresh to use the selected store."),
    sourceStatus("costco", "Costco", path.join(process.cwd(), "data", "costco", "current.json"), profile.costco.label || "Warehouse savings"),
    sourceStatus("wholefoods", "Whole Foods", path.join(process.cwd(), "data", "wholefoods", "current.json"), profile.wholeFoods.label || (profile.wholeFoods.postalCode ? `ZIP ${profile.wholeFoods.postalCode}` : "All-deals source")),
  ]);
}
