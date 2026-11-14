import { NextResponse } from "next/server";
import { isActive, loadDeals } from "@/lib/deals";
import { compareDiscounts, discountAmount, discountPercent } from "@/lib/discount";
import { offerSearchScore } from "@/lib/search";
import { loadStoreProfile } from "@/lib/profile";
import type { Offer } from "@/lib/types";

export const dynamic = "force-dynamic";

const retailerValues = new Set(["publix", "costco", "wholefoods"]);

function pageLimit(value: string | null): number {
  if (value === null) return 50;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
}

function pageOffset(value: string | null): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: unknown };
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? Number(parsed.offset) : 0;
  } catch {
    return 0;
  }
}

function nextCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function dealSummary(offer: Offer) {
  return {
    id: offer.id,
    retailer: offer.retailer,
    title: offer.title,
    brand: offer.brand,
    department: offer.department,
    category: offer.category,
    sourceCategories: offer.sourceCategories,
    description: offer.description || null,
    pricing: {
      salePrice: offer.promotion.salePrice ?? null,
      regularPrice: offer.promotion.regularPrice ?? null,
      discountAmount: discountAmount(offer),
      discountPercent: discountPercent(offer),
      discountBasis: offer.promotion.discountUnitBasis ?? "each",
    },
    promotion: {
      kind: offer.promotion.kind,
      text: offer.promotion.rawText,
      couponRequired: offer.promotion.couponRequired,
      buyQuantity: offer.promotion.buyQuantity ?? null,
      getQuantity: offer.promotion.getQuantity ?? null,
    },
    validity: { startsAt: offer.startsAt, endsAt: offer.endsAt },
    productUrl: offer.offerUrl,
  };
}

function compactDealSummary(offer: Offer) {
  return {
    id: offer.id,
    retailer: offer.retailer,
    title: offer.title,
    brand: offer.brand,
    category: offer.category,
    pricing: {
      salePrice: offer.promotion.salePrice ?? null,
      regularPrice: offer.promotion.regularPrice ?? null,
      discountAmount: discountAmount(offer),
      discountPercent: discountPercent(offer),
      discountBasis: offer.promotion.discountUnitBasis ?? "each",
    },
    promotion: {
      kind: offer.promotion.kind,
      text: offer.promotion.rawText,
      couponRequired: offer.promotion.couponRequired,
      buyQuantity: offer.promotion.buyQuantity ?? null,
      getQuantity: offer.promotion.getQuantity ?? null,
    },
    validity: { startsAt: offer.startsAt, endsAt: offer.endsAt },
    productUrl: offer.offerUrl,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const query = searchParams.get("q")?.trim().toLowerCase();
  const category = searchParams.get("category");
  const retailer = searchParams.get("retailer");
  const activeOnly = searchParams.get("active") === "true";
  const sort = searchParams.get("sort");
  const view = searchParams.get("view");
  let offers = await loadDeals(await loadStoreProfile());

  if (id) {
    const offer = offers.find((candidate) => candidate.id === id);
    return offer
      ? NextResponse.json({ deal: offer })
      : NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  if (query) {
    offers = offers
      .map((offer) => ({ offer, score: offerSearchScore(offer, query) }))
      .filter((result): result is { offer: typeof offers[number]; score: number } => result.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(({ offer }) => offer);
  }
  if (category) offers = offers.filter((offer) => offer.category === category);
  if (retailer && retailerValues.has(retailer)) offers = offers.filter((offer) => offer.retailer === retailer);
  if (activeOnly) offers = offers.filter((offer) => isActive(offer));

  if (sort === "discount_amount") offers.sort((a, b) => compareDiscounts(a, b, "amount") || a.title.localeCompare(b.title));
  if (sort === "discount_percent") offers.sort((a, b) => compareDiscounts(a, b, "percent") || a.title.localeCompare(b.title));
  if (sort === "title") offers.sort((a, b) => a.title.localeCompare(b.title));

  const limit = pageLimit(searchParams.get("limit"));
  const offset = pageOffset(searchParams.get("cursor"));
  const page = offers.slice(offset, offset + limit);

  return NextResponse.json({
    count: offers.length,
    limit,
    cursor: searchParams.get("cursor"),
    nextCursor: offset + page.length < offers.length ? nextCursor(offset + page.length) : null,
    deals: page.map(view === "compact" ? compactDealSummary : dealSummary),
  });
}
