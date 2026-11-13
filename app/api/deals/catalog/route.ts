import { NextResponse } from "next/server";
import { isActive, loadDeals } from "@/lib/deals";
import { loadStoreProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const offers = await loadDeals(await loadStoreProfile());
  const retailerCounts = new Map<string, { total: number; active: number; latestSourceUpdate: string | null }>();
  const categoryCounts = new Map<string, number>();

  for (const offer of offers) {
    const retailer = retailerCounts.get(offer.retailer) ?? { total: 0, active: 0, latestSourceUpdate: null };
    retailer.total += 1;
    if (isActive(offer)) retailer.active += 1;
    if (offer.sourceUpdatedAt && (!retailer.latestSourceUpdate || offer.sourceUpdatedAt > retailer.latestSourceUpdate)) retailer.latestSourceUpdate = offer.sourceUpdatedAt;
    retailerCounts.set(offer.retailer, retailer);
    categoryCounts.set(offer.category, (categoryCounts.get(offer.category) ?? 0) + 1);
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalDeals: offers.length,
    retailers: [...retailerCounts.entries()].map(([retailer, values]) => ({ retailer, ...values })).sort((a, b) => a.retailer.localeCompare(b.retailer)),
    categories: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category)),
    browsing: {
      endpoint: "/api/deals",
      filters: ["retailer", "category", "active", "view=compact"],
      sorts: ["title", "discount_amount", "discount_percent"],
      maximumPageSize: 100,
      detailLookup: "/api/deals?id=<deal-id>",
    },
  });
}
