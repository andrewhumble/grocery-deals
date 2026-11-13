import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceUrl = "https://www.costco.com/o/-/warehouse-savings";
const dataDirectory = process.env.PANTRY_SIGNAL_DATA_DIRECTORY ?? path.join(process.cwd(), "data");
const outputFile = path.join(dataDirectory, "costco", "current.json");
const temporaryFile = `${outputFile}.tmp`;
const nextFlightPrefix = "self.__next_f.push(";

function collectCouponSets(value, couponSets) {
  if (!value || typeof value !== "object") return;

  if (
    typeof value.couponSetId === "string" &&
    Array.isArray(value.couponCards) &&
    !couponSets.has(value.couponSetId)
  ) {
    couponSets.set(value.couponSetId, value.couponCards);
  }

  for (const child of Object.values(value)) collectCouponSets(child, couponSets);
}

function extractCouponSets(html) {
  const flightChunks = [];

  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!script.startsWith(nextFlightPrefix) || !script.endsWith(")")) continue;

    try {
      const [kind, payload] = JSON.parse(script.slice(nextFlightPrefix.length, -1));
      if (kind === 1 && typeof payload === "string") flightChunks.push(payload);
    } catch {
      // The page also contains ordinary JavaScript and non-model Flight frames.
    }
  }

  const couponSets = new Map();
  for (const record of flightChunks.join("").split("\n")) {
    const separator = record.indexOf(":");
    const json = separator >= 0 ? record.slice(separator + 1) : "";
    if (!json.startsWith("[")) continue;

    try {
      collectCouponSets(JSON.parse(json), couponSets);
    } catch {
      // Module-reference frames are not JSON model records.
    }
  }

  return couponSets;
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);

let response;
try {
  response = await fetch(sourceUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; PantrySignal/1.0)",
    },
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}

if (!response.ok) {
  throw new Error(`Costco returned ${response.status} ${response.statusText}`);
}

const couponSets = extractCouponSets(await response.text());
if (couponSets.size === 0) {
  throw new Error("Could not find Costco coupon sets in the Next.js page payload.");
}

const categories = [...couponSets.entries()].map(([category, deals]) => ({ category, deals }));
const dealCount = categories.reduce((count, category) => count + category.deals.length, 0);
const payload = {
  source: sourceUrl,
  retrievedAt: new Date().toISOString(),
  dealCount,
  categories,
};

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`);
await rename(temporaryFile, outputFile);

console.log(`Saved ${dealCount} Costco offers to ${path.relative(process.cwd(), outputFile)}.`);
