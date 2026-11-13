import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const dealsPageUrl =
  "https://www.wholefoodsmarket.com/fmc/alldeals/?_encoding=UTF8&almBrandId=VUZHIFdob2xlIEZvb2Rz&ref_=US_TRF_ALL_UFG_WFM_REFER_1000562";
const productsEndpoint = "https://www.wholefoodsmarket.com/api/wwos/products";
const dataDirectory = process.env.PANTRY_SIGNAL_DATA_DIRECTORY ?? path.join(process.cwd(), "data");
const outputFile = path.join(dataDirectory, "wholefoods", "current.json");
const temporaryFile = `${outputFile}.tmp`;
const batchSize = 10;
const concurrency = 2;

async function fetchWithTimeout(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`Whole Foods returned ${response.status} ${response.statusText}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function extractDealAsins(html) {
  const dealList = html.match(/data-client-recs-list="([\s\S]*?)"/i)?.[1];
  if (!dealList) throw new Error("Could not find Whole Foods' all-deals product list.");

  const asins = [];
  const seen = new Set();
  for (const [, asin] of dealList.matchAll(/&quot;id&quot;:&quot;([A-Z0-9]{10})&quot;/g)) {
    if (!seen.has(asin)) {
      seen.add(asin);
      asins.push(asin);
    }
  }

  if (asins.length === 0) throw new Error("Whole Foods' all-deals product list did not contain ASINs.");
  return asins;
}

function splitIntoBatches(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function fetchProductBatch(asins) {
  const endpoint = new URL(productsEndpoint);
  endpoint.search = new URLSearchParams({
    asins: asins.join(","),
    programType: "GROCERY",
    offerListingDiscriminator: "A08P",
  }).toString();

  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; PantrySignal/1.0)",
      });
      const products = await response.json();
      if (!Array.isArray(products)) throw new Error("Unexpected Whole Foods product response: expected an array.");
      return products;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }

  throw lastError;
}

const pageResponse = await fetchWithTimeout(dealsPageUrl, {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (compatible; PantrySignal/1.0)",
});
const dealAsins = extractDealAsins(await pageResponse.text());
const batches = splitIntoBatches(dealAsins, batchSize);
const products = [];

for (let index = 0; index < batches.length; index += concurrency) {
  const batchProducts = await Promise.all(batches.slice(index, index + concurrency).map(fetchProductBatch));
  products.push(...batchProducts.flat());
}

const productsByAsin = new Map(products.filter((product) => product?.asin).map((product) => [product.asin, product]));
const deals = dealAsins.flatMap((asin) => {
  const product = productsByAsin.get(asin);
  return product ? [product] : [];
});
const missingAsins = dealAsins.filter((asin) => !productsByAsin.has(asin));

if (deals.length === 0) throw new Error("Whole Foods returned no product details for its all-deals list.");

const payload = {
  source: dealsPageUrl,
  productsEndpoint,
  retrievedAt: new Date().toISOString(),
  listedDealCount: dealAsins.length,
  dealCount: deals.length,
  missingAsins,
  deals,
};

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`);
await rename(temporaryFile, outputFile);

console.log(`Saved ${deals.length} Whole Foods offers to ${path.relative(process.cwd(), outputFile)}.`);
