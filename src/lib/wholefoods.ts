import { canonicalCategory, decodeHtml, normalizeSearchText, parsePromotion, productSlug } from "./normalize";
import type { Offer, Promotion } from "./types";

type WholeFoodsPrice = {
  priceAmount?: number | null;
  basisPriceAmount?: number | null;
  savings?: { savingsAmount?: number | null; percentSavings?: string | null } | null;
  primeBenefit?: { priceAmount?: number | null; text?: string | null } | null;
};

type WholeFoodsDeal = {
  asin: string;
  name?: string;
  brandName?: string;
  description?: string;
  productImages?: string[];
  availability?: string | null;
  category?: { displayName?: string; productType?: string; glProductGroupSymbol?: string } | null;
  offerDetails?: { price?: WholeFoodsPrice | null; unitPrice?: { baseUnit?: string | null; priceAmount?: number | null } | null } | null;
};

type WholeFoodsPayload = { retrievedAt?: string; deals: WholeFoodsDeal[] };

function currency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function promotionFor(deal: WholeFoodsDeal): { promotion: Promotion; advertisedSavingsText: string | null; primeText: string | null } {
  const price = deal.offerDetails?.price;
  const salePrice = price?.priceAmount;
  const savings = price?.savings?.savingsAmount;
  const percent = price?.savings?.percentSavings;
  const primePrice = price?.primeBenefit?.priceAmount;

  if (typeof salePrice !== "number") {
    return {
      promotion: parsePromotion("Deal listed; price unavailable for current location"),
      advertisedSavingsText: null,
      primeText: null,
    };
  }

  const promotion = parsePromotion(currency(salePrice));
  if (typeof savings === "number") promotion.amountOff = savings;
  if (percent) promotion.percentOff = Number(percent.replace("%", ""));
  if (typeof price?.basisPriceAmount === "number" && price.basisPriceAmount > salePrice) promotion.regularPrice = price.basisPriceAmount;
  const savingText = typeof savings === "number"
    ? `Save ${currency(savings)}${percent ? ` (${percent})` : ""}`
    : price?.basisPriceAmount ? `Regularly ${currency(price.basisPriceAmount)}` : null;
  promotion.rawText = [currency(salePrice), savingText].filter(Boolean).join(" · ");

  return {
    promotion,
    advertisedSavingsText: savingText,
    primeText: typeof primePrice === "number" ? `Prime price ${currency(primePrice)}; membership required.` : null,
  };
}

export function normalizeWholeFoodsResponse(raw: WholeFoodsPayload): Offer[] {
  return raw.deals.map((deal) => {
    const title = decodeHtml(deal.name || "Whole Foods deal");
    const description = decodeHtml(deal.description);
    const sourceCategory = deal.category?.displayName || "Whole Foods";
    const productType = deal.category?.productType?.replaceAll("_", " ") || "";
    const { promotion, advertisedSavingsText, primeText } = promotionFor(deal);
    const allSearchText = [title, deal.brandName, description, sourceCategory, productType, promotion.rawText].filter(Boolean).join(" ");

    return {
      id: `wholefoods:${deal.asin}`,
      retailer: "wholefoods" as const,
      storeId: "all-deals",
      sourceUpdatedAt: raw.retrievedAt,
      title,
      description,
      brand: deal.brandName || null,
      department: sourceCategory,
      sourceCategories: [sourceCategory, productType].filter(Boolean),
      category: canonicalCategory(sourceCategory, [productType]),
      imageUrl: deal.productImages?.[0] ?? null,
      promotion,
      advertisedSavingsText,
      finePrint: primeText,
      startsAt: raw.retrievedAt ?? null,
      endsAt: null,
      validityText: null,
      availability: deal.availability === "IN_STOCK" ? "in_stock" : null,
      offerUrl: `https://www.wholefoodsmarket.com/product/${productSlug(title)}-${deal.asin.toLowerCase()}`,
      searchableText: normalizeSearchText(allSearchText),
      source: {
        offerId: deal.asin,
        baseProductId: deal.asin,
        itemCode: null,
        savingType: "all_deals",
        promotionType: deal.availability ?? null,
      },
    };
  });
}
