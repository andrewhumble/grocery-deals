import type { Offer, Promotion, PromotionKind, RawPublixProductSnapshot, RawPublixResponse, RawPublixSaving } from "./types";

const entityMap: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  reg: "®",
  trade: "™",
};

export function decodeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => {
      const point = code.toLowerCase().startsWith("x") ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _match;
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => entityMap[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function productSlug(value: string): string {
  return decodeHtml(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parsePromotion(rawText: string): Promotion {
  const raw = decodeHtml(rawText);
  const normalized = raw.toLowerCase();
  const couponRequired = /digital coupon|mfr coupon/.test(normalized);
  const promotion: Promotion = { rawText: raw, kind: "unknown", couponRequired };

  const buyGet = normalized.match(/buy\s+(?:any\s+)?(\d+).*?get\s+(?:any\s+)?(\d+)\s+free/);
  if (buyGet) {
    promotion.kind = "buy_x_get_y";
    promotion.buyQuantity = Number(buyGet[1]);
    promotion.getQuantity = Number(buyGet[2]);
    return promotion;
  }

  const multiBuy = normalized.match(/^(\d+)\s*(?:for|\/)\s*\$(\d+(?:\.\d{1,2})?)/);
  if (multiBuy) {
    promotion.kind = "multi_buy";
    promotion.bundleQuantity = Number(multiBuy[1]);
    promotion.bundlePrice = Number(multiBuy[2]);
    return promotion;
  }

  const percent = normalized.match(/^(\d+(?:\.\d+)?)%\s*off/);
  if (percent) {
    promotion.kind = "percent_off";
    promotion.percentOff = Number(percent[1]);
    return promotion;
  }

  const threshold = normalized.match(/^\$(\d+(?:\.\d+)?)\s*off(?:\s+with every)?\s+\$(\d+(?:\.\d+)?)/);
  if (threshold) {
    promotion.kind = "threshold_discount";
    promotion.amountOff = Number(threshold[1]);
    promotion.minimumSpend = Number(threshold[2]);
    return promotion;
  }

  const amountOff = normalized.match(/^\$?(\d+(?:\.\d+)?)(¢)?\s*off(?:\s*\/\s*(lb|each))?/);
  if (amountOff) {
    promotion.kind = "amount_off";
    promotion.amountOff = Number(amountOff[1]) / (amountOff[2] ? 100 : 1);
    promotion.discountUnitBasis = amountOff[3] === "lb" ? "lb" : "each";
    return promotion;
  }

  const save = normalized.match(/^save\s+\$?(\d+(?:\.\d+)?)(¢)?(?:\s*\/\s*(lb|each))?/);
  if (save) {
    promotion.kind = "amount_off";
    promotion.amountOff = Number(save[1]) / (save[2] ? 100 : 1);
    promotion.discountUnitBasis = save[3] === "lb" ? "lb" : "each";
    return promotion;
  }

  const price = normalized.match(/^(?:sale price\s+)?\$(\d+(?:\.\d+)?)(?:\s*(lb|each))?$/);
  if (price) {
    promotion.kind = "unit_price";
    promotion.salePrice = Number(price[1]);
    promotion.unitBasis = price[2] === "lb" ? "lb" : "each";
  }

  return promotion;
}

export function canonicalCategory(department: string | null, categories: string[]): string {
  const raw = `${department ?? ""} ${categories.join(" ")}`.toLowerCase();
  if (/produce|vegetable|fruit/.test(raw)) return "Produce";
  if (/meat|protein/.test(raw)) return "Meat & poultry";
  if (/seafood/.test(raw)) return "Seafood";
  if (/deli/.test(raw)) return "Deli";
  if (/bakery|bread/.test(raw)) return "Bakery";
  if (/dairy|cheese|yogurt|milk/.test(raw)) return "Dairy & eggs";
  if (/frozen/.test(raw)) return "Frozen";
  if (/beer|wine/.test(raw)) return "Beer & wine";
  if (/health|beauty|medicine|vitamin/.test(raw)) return "Health & personal care";
  if (/non-food|houseware|clean|paper|laundry/.test(raw)) return "Household";
  if (/apparel/.test(raw)) return "Apparel";
  if (/appliance|electronic/.test(raw)) return "Electronics & appliances";
  if (/automotive/.test(raw)) return "Automotive";
  if (/furniture|mattress/.test(raw)) return "Furniture";
  if (/home improvement|patio|lawn|garden/.test(raw)) return "Home & garden";
  if (/pet/.test(raw)) return "Pets";
  return "Pantry & grocery";
}

function normalizeSaving(raw: RawPublixSaving, sourceUpdatedAt: string | undefined, storeId: string): Offer {
  const title = decodeHtml(raw.title);
  const description = decodeHtml(raw.description);
  const brand = raw.brand && raw.brand !== "Other" ? decodeHtml(raw.brand) : null;
  const department = raw.department ? decodeHtml(raw.department) : null;
  const sourceCategories = raw.categories ?? [];
  const promotion = parsePromotion(raw.savings);
  const extra = decodeHtml(raw.additionalSavings || raw.additionalDealInfo);
  const finePrint = decodeHtml([raw.description, raw.finePrint, raw.Terms].filter(Boolean).join(" ")) || null;
  const category = canonicalCategory(department, sourceCategories);
  const allSearchText = [title, description, brand, department, category, ...sourceCategories, promotion.rawText, extra, finePrint]
    .filter(Boolean)
    .join(" ");

  return {
    id: `publix:${storeId}:${raw.id}`,
    retailer: "publix",
    storeId,
    sourceUpdatedAt,
    title,
    description,
    brand,
    department,
    sourceCategories,
    category,
    imageUrl: raw.enhancedImageUrl || raw.imageUrl || null,
    promotion,
    advertisedSavingsText: extra || null,
    finePrint,
    startsAt: raw.wa_startDate,
    endsAt: raw.wa_endDate,
    validityText: null,
    availability: null,
    offerUrl: raw.baseProductId ? `https://www.publix.com/pd/${productSlug(title)}/${raw.baseProductId}` : null,
    searchableText: normalizeSearchText(allSearchText),
    source: {
      offerId: raw.id,
      baseProductId: raw.wa_baseProductId_s ?? null,
      itemCode: raw.wa_itemCode ?? null,
      savingType: raw.savingType ?? null,
      promotionType: raw.wa_promotionType ?? null,
    },
  };
}

export function normalizePublixResponse(raw: RawPublixResponse, storeId: string): Offer[] {
  return raw.Savings.map((saving) => normalizeSaving(saving, raw.WeeklyAdLatestUpdatedDateTime, storeId));
}

function validDate(value: string | null | undefined): string | null {
  return value && !value.startsWith("0001-") ? value : null;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function normalizeTemporaryPriceReduction(product: RawPublixSaving, sourceUpdatedAt: string | undefined, storeId: string): Offer {
  const title = decodeHtml(product.title || "Publix sale product");
  const description = decodeHtml(product.description);
  const brand = product.brand && product.brand !== "Other" ? decodeHtml(product.brand) : null;
  const department = product.department ? decodeHtml(product.department) : null;
  const sourceCategories = product.categories ?? [];
  const salePrice = product.finalPrice ?? 0;
  const originalPrice = product.originalDeal ?? 0;
  const promotion = parsePromotion(money(salePrice));
  promotion.kind = "unit_price";
  promotion.salePrice = salePrice;
  const savingsText = decodeHtml(product.savings);
  if (/\/(?:\s*)lb\b|\bper\s+pound\b/i.test(savingsText)) promotion.unitBasis = "lb";
  const advertisedSaving = parsePromotion(savingsText);
  if (advertisedSaving.kind === "buy_x_get_y") {
    promotion.kind = "buy_x_get_y";
    promotion.buyQuantity = advertisedSaving.buyQuantity;
    promotion.getQuantity = advertisedSaving.getQuantity;
  }
  if (typeof advertisedSaving.amountOff === "number") {
    promotion.amountOff = advertisedSaving.amountOff;
    promotion.discountUnitBasis = advertisedSaving.discountUnitBasis;
  }
  if (typeof product.promoTotalSavings === "number" && product.promoTotalSavings > 0) {
    promotion.amountOff = product.promoTotalSavings;
    promotion.discountUnitBasis = "transaction";
  } else if (promotion.kind === "buy_x_get_y" && salePrice > 0 && typeof promotion.getQuantity === "number") {
    // Older snapshots predate promoTotalSavings. For a buy/get offer, the
    // transaction saving is the displayed item price times the free quantity.
    promotion.amountOff = salePrice * promotion.getQuantity;
    promotion.discountUnitBasis = "transaction";
  }
  // Publix's originalDeal can be a bundle/list price rather than a price for
  // the displayed unit. Only retain it for percentage math when it agrees with
  // the explicit advertised saving.
  if (originalPrice > salePrice && typeof promotion.amountOff === "number" && promotion.discountUnitBasis !== "lb"
    && Math.abs((originalPrice - salePrice) - promotion.amountOff) < 0.01) {
    promotion.regularPrice = originalPrice;
  }
  const additionalSavingsText = decodeHtml(product.additionalDealInfo);
  const priceParts = [
    money(salePrice),
    savingsText && (product.savingType === "WeeklyAdProduct" ? savingsText : `Save ${savingsText.replace(/^save\s*/i, "")}`),
    // Prefer a specific product saving over broad "Save up to" ad copy. The
    // latter is still preserved in the raw source for detail views and audits.
    !savingsText && product.savingType === "WeeklyAdProduct" && additionalSavingsText,
  ];
  promotion.rawText = priceParts.filter(Boolean).join(" · ");
  const finePrint = decodeHtml([product.finePrint, product.Terms].filter(Boolean).join(" ")) || null;
  const category = canonicalCategory(department, sourceCategories);
  const allSearchText = [title, description, brand, department, category, ...sourceCategories, promotion.rawText, finePrint]
    .filter(Boolean)
    .join(" ");
  // The same SKU may participate in multiple promotion groups. Keep the
  // promotion instance in its ID so React never receives duplicate keys.
  const productId = product.id || product.baseProductId;

  return {
    id: `publix:${storeId}:product:${productId}`,
    retailer: "publix",
    storeId,
    sourceUpdatedAt,
    title,
    description,
    brand,
    department,
    sourceCategories,
    category,
    imageUrl: product.enhancedImageUrl || product.imageUrl || null,
    promotion,
    advertisedSavingsText: originalPrice > 0 ? `Regularly ${money(originalPrice)}` : null,
    finePrint,
    startsAt: validDate(product.dc_startDate),
    endsAt: validDate(product.dc_endDate),
    validityText: null,
    availability: null,
    offerUrl: product.baseProductId ? `https://www.publix.com/pd/${productSlug(title)}/${product.baseProductId}` : null,
    searchableText: normalizeSearchText(allSearchText),
    source: {
      offerId: product.id,
      baseProductId: product.baseProductId ?? null,
      itemCode: product.wa_itemCode || null,
      savingType: product.savingType === "WeeklyAdProduct" ? "eligible_weekly_ad_product" : "temporary_price_reduction",
      promotionType: product.wa_promotionType ?? (product.savingType === "WeeklyAdProduct" ? "Weekly Ad" : "Tpr"),
    },
  };
}

export function normalizePublixSnapshot(raw: RawPublixProductSnapshot, storeId: string): Offer[] {
  if (!raw.products?.length) return normalizePublixResponse(raw.promotions ?? { Savings: [] }, storeId);
  const productOffers = raw.products
    .filter((product) => (product.savingType === "Tpr" || product.savingType === "WeeklyAdProduct") && typeof product.finalPrice === "number" && product.finalPrice > 0)
    .map((product) => normalizeTemporaryPriceReduction(product, raw.retrievedAt ?? raw.promotions?.WeeklyAdLatestUpdatedDateTime, storeId));
  // Publix returns a SKU once for each qualifying promotion group. Show one
  // card when the shopper-facing price, terms, and validity are identical.
  const products = Array.from(new Map(productOffers.map((offer) => [
    [offer.source.baseProductId ?? offer.id, offer.promotion.salePrice ?? "", offer.promotion.rawText, offer.startsAt ?? "", offer.endsAt ?? ""].join("|"),
    offer,
  ])).values());
  // Product-level TPRs are the primary search corpus, but grouped weekly-ad
  // deals have no per-SKU price and must remain visible (for example, BOGOs).
  const groupedPromotions = (raw.promotions?.Savings ?? [])
    .filter((saving) => (saving.savingType === "WeeklyAd" || saving.savingType === "Stacked") && !raw.eligiblePromotionIds?.includes(saving.id))
    .map((saving) => normalizeSaving(saving, raw.promotions?.WeeklyAdLatestUpdatedDateTime ?? raw.retrievedAt, storeId));
  return [...products, ...groupedPromotions];
}

export function promotionLabel(kind: PromotionKind): string {
  return {
    unit_price: "Sale price",
    multi_buy: "Multi-buy",
    buy_x_get_y: "BOGO",
    amount_off: "Amount off",
    percent_off: "Percent off",
    threshold_discount: "Spend & save",
    unknown: "Offer",
  }[kind];
}
