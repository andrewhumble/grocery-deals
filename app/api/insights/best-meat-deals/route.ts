import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { isActive, loadDeals } from "@/lib/deals";
import { bestMeatDeals, meatRankingPolicy, meatScope } from "@/lib/meat-insights";
import { loadStoreProfile } from "@/lib/profile";
import type { Retailer } from "@/lib/types";

export const dynamic = "force-dynamic";

function retailerParam(value: string | null): Retailer | undefined {
  return value === "publix" || value === "costco" || value === "wholefoods" ? value : undefined;
}

export async function GET(request: Request) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 10;
  const offers = (await loadDeals(await loadStoreProfile())).filter((offer) => isActive(offer));
  const retailer = retailerParam(searchParams.get("retailer"));
  const deals = bestMeatDeals(offers, retailer, limit);

  return NextResponse.json({
    asOf: new Date().toISOString(),
    scope: meatScope,
    rankingPolicy: meatRankingPolicy,
    retailer: retailer ?? null,
    count: deals.length,
    deals,
  });
}
