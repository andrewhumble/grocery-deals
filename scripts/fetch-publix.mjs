import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const savingsEndpoint = "https://services.publix.com/api/v4/savings";
const productsEndpoint = "https://services.publix.com/search/api/search/storeproductssavings/";
const eligibleProductsQuery = `query GetStoreProductsSavingsSearchResultAsync($keyword: String, $skip: Int!, $take: Int!, $facetOverrideStr: String, $facets: String, $sortOrder: String, $ispu: Boolean, $categoryID: String, $minMatch: Int!, $boostVarIndex: Int!, $wildcardSearch: Boolean!, $isPreviewSite: Boolean!, $segmentVarIndex: Int!, $getOrderHistory: Boolean!, $filterQuery: String, $reorderItemCodes: [Int!], $intents: [String!], $searchRetryIndex: Int!, $intentVarIndex: Int!, $boostBuryQuery: String, $source: String, $elevatedProducts: [KeyValuePairOfStringAndStringInput!], $couponId: String, $forceElevation: Boolean, $searchVariation: [KeyValuePairOfStringAndStringInput!], $userCoupon: String) { storeProductsSavingsSearchResult(keyword: $keyword, skip: $skip, take: $take, facetOverrideStr: $facetOverrideStr, facets: $facets, sortOrder: $sortOrder, ispu: $ispu, categoryID: $categoryID, minMatch: $minMatch, boostVarIndex: $boostVarIndex, wildcardSearch: $wildcardSearch, isPreviewSite: $isPreviewSite, segmentVarIndex: $segmentVarIndex, getOrderHistory: $getOrderHistory, filterQuery: $filterQuery, reorderItemCodes: $reorderItemCodes, intents: $intents, boostBuryQuery: $boostBuryQuery, searchRetryIndex: $searchRetryIndex, intentVarIndex: $intentVarIndex, source: $source, elevatedProducts: $elevatedProducts, couponId: $couponId, forceElevation: $forceElevation, searchVariation: $searchVariation, userCoupon: $userCoupon) { storeProducts { baseProductId itemCode title shortDescription sizeDescription priceLine originalPriceLine promoConditionsMsg promoMsg promoType promoTotalSavings promoValidThruMsg titleBrand imageUrls { large { a } small { a } } } } }`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const retryDelay = (attempt) => Number(process.env.PANTRY_PUBLIX_RETRY_BASE_MS ?? 15_000) * (2 ** attempt);
const requestTimeout = Number(process.env.PANTRY_PUBLIX_REQUEST_TIMEOUT_MS ?? 20_000);

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, target);
}

function priceNumber(value) {
  const match = value?.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

async function fetchEligibleProducts(promotion, storeId) {
  const filterQuery = promotion.promoGroupIds.split(",").map((id) => `promoGroupId::${id}`).join("||");
  const variables = { skip: 0, take: 1000, source: "WEB_WEEKLYAD_MODAL", sortOrder: "salesRank asc", minMatch: 0, segmentVarIndex: 0, getOrderHistory: false, intents: [], isPreviewSite: false, reorderItemCodes: null, wildcardSearch: false, filterQuery, keyword: "", boostBuryQuery: "", elevatedProducts: [], forceElevation: false, boostVarIndex: 0, searchRetryIndex: 0, intentVarIndex: 1, userCoupon: null, searchVariation: [] };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(productsEndpoint, { method: "POST", headers: { Accept: "*/*", "Content-Type": "application/json", Origin: "https://www.publix.com", Referer: "https://www.publix.com/", PublixStore: storeId, "X-PE": "True", "X-Src": "WEB_WEEKLYAD_MODAL", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" }, body: JSON.stringify({ operationName: "GetStoreProductsSavingsSearchResultAsync", variables, query: eligibleProductsQuery }), signal: AbortSignal.timeout(requestTimeout) });
    if (response.ok) {
      const body = await response.json();
      if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
      return body.data?.storeProductsSavingsSearchResult?.storeProducts ?? [];
    }
    if (attempt === 2) throw new Error(`HTTP ${response.status}`);
    await delay(retryDelay(attempt));
  }
  return [];
}

async function configuredStoreId() {
  if (process.env.PUBLIX_STORE_ID) return process.env.PUBLIX_STORE_ID;
  try {
    const profile = JSON.parse(await readFile(path.join(process.cwd(), "data", "profile.json"), "utf8"));
    if (/^\d+$/.test(profile?.publix?.storeId)) return profile.publix.storeId;
  } catch {
    // The checked-in default keeps a fresh clone usable before a profile exists.
  }
  return "719";
}

const storeId = await configuredStoreId();
const dataDirectory = process.env.PANTRY_SIGNAL_DATA_DIRECTORY ?? path.join(process.cwd(), "data");
const targetDirectory = path.join(dataDirectory, "publix", storeId);
const target = path.join(targetDirectory, "current.json");
const checkpointTarget = path.join(targetDirectory, "eligible-products.checkpoint.json");
await mkdir(targetDirectory, { recursive: true });
const endpoint = new URL(savingsEndpoint);
endpoint.search = new URLSearchParams({
  smImg: "235",
  enImg: "368",
  fallbackImg: "false",
  isMobile: "false",
  page: "1",
  pageSize: "0",
  includePersonalizedDeals: "false",
  languageID: "1",
  isWeb: "true",
}).toString();

let allSavings;
if (process.env.PUBLIX_USE_CACHED_SAVINGS === "true") {
  const cached = JSON.parse(await readFile(target, "utf8"));
  allSavings = cached.promotions;
} else {
const response = await fetch(endpoint, {
  headers: { Accept: "application/json", PublixStore: storeId, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" },
  signal: AbortSignal.timeout(requestTimeout),
});
  if (!response.ok) throw new Error(`Publix returned ${response.status} ${response.statusText}`);
  allSavings = await response.json();
}
if (!Array.isArray(allSavings.Savings)) throw new Error("Unexpected response: Savings was not an array.");

// TPRs are product-level markdowns, unlike a weekly-ad group promotion. Each
// currently carries a unique baseProductId, finalPrice, and originalDeal.
const products = allSavings.Savings.filter((saving) => (
  saving.savingType === "Tpr"
  && typeof saving.baseProductId === "string"
  && Number.isFinite(saving.finalPrice)
  && saving.finalPrice > 0
));
const weeklyPromotionCount = allSavings.Savings.filter((saving) => saving.savingType === "WeeklyAd" || saving.savingType === "Stacked").length;
const groupedPromotions = allSavings.Savings.filter((saving) => (saving.savingType === "WeeklyAd" || saving.savingType === "Stacked") && typeof saving.promoGroupIds === "string" && saving.promoGroupIds.length > 0);
const checkpointVersion = 2;
const savedCheckpoint = existsSync(checkpointTarget) ? JSON.parse(await readFile(checkpointTarget, "utf8")) : null;
const checkpoint = savedCheckpoint?.version === checkpointVersion
  ? savedCheckpoint
  : { version: checkpointVersion, storeId, byPromotionId: {} };
if (checkpoint.storeId !== storeId) throw new Error(`Checkpoint store ${checkpoint.storeId} does not match selected store ${storeId}.`);
let lastEligibleRequestAt = 0;
const limit = Math.max(Number(process.env.PUBLIX_ELIGIBLE_LIMIT ?? groupedPromotions.length), 1);
let attempted = 0;
const failures = [];
for (const promotion of groupedPromotions) {
  if (checkpoint.byPromotionId[promotion.id]) continue;
  if (attempted >= limit) break;
  attempted += 1;
  try {
    lastEligibleRequestAt = Date.now();
    checkpoint.byPromotionId[promotion.id] = await fetchEligibleProducts(promotion, storeId);
    await writeJsonAtomic(checkpointTarget, checkpoint);
  } catch (error) {
    failures.push({ promotionId: promotion.id, error: error instanceof Error ? error.message : String(error) });
    break;
  }
}
const unresolved = groupedPromotions.filter((promotion) => !checkpoint.byPromotionId[promotion.id]);
const eligiblePromotionIds = Object.entries(checkpoint.byPromotionId).filter(([, eligible]) => eligible.length > 0).map(([promotionId]) => promotionId);
const eligibleProducts = groupedPromotions.flatMap((promotion) => (checkpoint.byPromotionId[promotion.id] ?? []).map((product) => ({
  id: `${promotion.id}:${product.baseProductId || product.itemCode}`,
  baseProductId: product.baseProductId,
  wa_itemCode: product.itemCode,
  finalPrice: priceNumber(product.priceLine),
  originalDeal: priceNumber(product.originalPriceLine),
  promoTotalSavings: product.promoTotalSavings,
  title: product.title,
  description: [product.shortDescription, product.sizeDescription].filter(Boolean).join(" · "),
  savings: product.promoMsg || promotion.savings,
  additionalDealInfo: product.promoConditionsMsg || promotion.additionalDealInfo,
  imageUrl: product.imageUrls?.large?.a || product.imageUrls?.small?.a || promotion.imageUrl,
  enhancedImageUrl: product.imageUrls?.large?.a || null,
  brand: product.titleBrand || promotion.brand,
  department: promotion.department,
  categories: promotion.categories,
  savingType: "WeeklyAdProduct",
  wa_promotionType: product.promoType || promotion.wa_promotionType,
  wa_startDate: promotion.wa_startDate,
  wa_endDate: promotion.wa_endDate,
  finePrint: product.promoValidThruMsg || null,
})));
const payload = {
  source: { savingsEndpoint },
  retrievedAt: new Date().toISOString(),
  storeId,
  products: [...products, ...eligibleProducts],
  // Keep all non-product offer data available for follow-up/AI queries. The
  // UI uses products as its primary searchable collection.
  promotions: allSavings,
  eligiblePromotionIds,
  unresolvedPromotionCount: unresolved.length,
  eligibleProductFailures: [],
};
await writeJsonAtomic(target, payload);

console.log(`Saved ${products.length + eligibleProducts.length} priced Publix products (${eligibleProducts.length} from grouped promotions), ${weeklyPromotionCount} weekly promotions, and ${allSavings.Savings.length} total savings records for store ${storeId} to ${path.relative(process.cwd(), target)}.`);
if (unresolved.length) console.log(`Eligible product lookups remaining: ${unresolved.length}/${groupedPromotions.length}; progress is checkpointed for the next refresh.`);
if (failures.length) console.error(`Paused after ${failures[0].promotionId}: ${failures[0].error}`);
