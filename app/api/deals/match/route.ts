import { NextResponse } from "next/server";
import { loadStoreProfile } from "@/lib/profile";
import { loadDealCheckCatalog } from "@/lib/deal-check-sources";
import { checkDeals, itemTokens } from "@/lib/deal-check";
import type { SearchScope } from "@/lib/retrieval/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const item = params.get("item")?.trim();
  const scope = params.get("scope") ?? "exact";
  if (!item || !itemTokens(item).length || !["exact", "substitutes", "related"].includes(scope)) {
    return NextResponse.json({ error: "Provide a nonempty item and scope exact, substitutes, or related." }, { status: 400 });
  }
  const now = new Date();
  const profile = await loadStoreProfile();
  const catalog = await loadDealCheckCatalog(process.env.PUBLIX_STORE_ID ?? profile.publix.storeId, { now });
  return NextResponse.json(checkDeals(item, catalog, scope as SearchScope, now), {
    status: catalog.sources.every(s => s.state === "unavailable") ? 503 : 200,
  });
}
