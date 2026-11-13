import { canonicalCategory, decodeHtml, normalizeSearchText, parsePromotion } from "./normalize";
import type { Offer, Promotion } from "./types";

type CostcoPrice = {
  prepend_text?: string;
  value?: string[];
  append_text?: string;
  add_currency?: boolean;
};

type CostcoDeal = {
  cardDescription?: string;
  offerDetails?: string;
  validDatesOverride?: string;
  couponType?: string;
  productId?: string;
  itemNumber?: string;
  applicability?: "warehouse_only" | "warehouse_online" | "online_only";
  offerTerms?: string;
  imageUrl?: string;
  productImage?: Array<{ url?: string; thumbnailUrl?: string }>;
  couponLink?: { title?: string; url?: string };
  pricesOffCSObject?: CostcoPrice[];
};

type CostcoPayload = {
  retrievedAt?: string;
  categories: Array<{ category: string; deals: CostcoDeal[] }>;
};

function priceText(price: CostcoPrice): string {
  const values = (price.value ?? []).map((value) => `${price.add_currency ? "$" : ""}${value}`).join("–");
  return [price.prepend_text, values, price.append_text].filter(Boolean).join(" ");
}

function promotionFor(deal: CostcoDeal): { promotion: Promotion; advertisedSavingsText: string | null } {
  const text = (deal.pricesOffCSObject ?? []).map(priceText).filter(Boolean).join("; ");
  const promotion = parsePromotion(text || "Current Costco savings");
  const firstPrice = deal.pricesOffCSObject?.[0];
  const values = firstPrice?.value ?? [];
  const firstValue = values.length === 1 ? Number(values[0]) : Number.NaN;
  const discount = text.match(/(?:after|save)\s+\$([\d,.]+)/i);

  if (Number.isFinite(firstValue) && !/^save\b/i.test(text)) {
    promotion.kind = "unit_price";
    promotion.salePrice = firstValue;
  }
  if (discount) promotion.amountOff = Number(discount[1].replace(",", ""));
  if (Number.isFinite(firstValue) && typeof promotion.amountOff === "number") promotion.regularPrice = firstValue + promotion.amountOff;

  return { promotion, advertisedSavingsText: text || null };
}

function explicitEndDate(text: string): string | null {
  const match = text.match(/valid\s+(?:through|until)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!match) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), 23, 59, 59)).toISOString();
}

export function normalizeCostcoResponse(raw: CostcoPayload): Offer[] {
  const retrievedAt = raw.retrievedAt;
  return raw.categories.flatMap(({ category: sourceCategory, deals }) => deals.map((deal, index) => {
    const title = decodeHtml(deal.cardDescription || deal.couponLink?.title || "Costco warehouse savings");
    const description = decodeHtml(deal.offerDetails);
    const validityText = decodeHtml(deal.validDatesOverride);
    const terms = decodeHtml(deal.offerTerms);
    const { promotion, advertisedSavingsText } = promotionFor(deal);
    const sourceOfferId = deal.productId || deal.itemNumber || deal.couponLink?.url || `${sourceCategory}:${index}:${title}`;
    const allSearchText = [title, description, sourceCategory, validityText, terms, promotion.rawText, deal.applicability]
      .filter(Boolean)
      .join(" ");

    return {
      id: `costco:${sourceOfferId}`,
      retailer: "costco" as const,
      storeId: "warehouse-savings",
      sourceUpdatedAt: retrievedAt,
      title,
      description,
      brand: null,
      department: sourceCategory,
      sourceCategories: [sourceCategory],
      category: canonicalCategory(null, [sourceCategory]),
      imageUrl: deal.imageUrl || deal.productImage?.[0]?.thumbnailUrl || deal.productImage?.[0]?.url || null,
      promotion,
      advertisedSavingsText,
      finePrint: [validityText, terms].filter(Boolean).join(" ") || null,
      startsAt: retrievedAt ?? null,
      endsAt: explicitEndDate(validityText),
      validityText: validityText || null,
      availability: deal.applicability ?? null,
      offerUrl: deal.couponLink?.url ?? null,
      searchableText: normalizeSearchText(allSearchText),
      source: {
        offerId: sourceOfferId,
        baseProductId: deal.productId ?? null,
        itemCode: deal.itemNumber ? Number(deal.itemNumber) : null,
        savingType: deal.couponType ?? null,
        promotionType: deal.applicability ?? null,
      },
    };
  }));
}
