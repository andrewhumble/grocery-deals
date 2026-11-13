import "server-only";

import type { GroceryMatch, Offer } from "../types";
import { offerRef } from "./document";
import { searchDealCandidates } from "./search";

export async function matchGroceryItemFromIndex(item: string, offers: Offer[]): Promise<GroceryMatch[]> {
  const result = await searchDealCandidates({ query: item, scope: "substitutes", filters: { active: true }, limit: 3 });
  const offersByRef = new Map(offers.map((offer) => [offerRef(offer.id), offer]));
  return result.candidates.flatMap((candidate) => {
    const offer = offersByRef.get(candidate.ref);
    if (!offer) return [];
    const warnings = [
      offer.promotion.couponRequired ? "Requires a manufacturer digital coupon." : "",
      /exclud|select|participating|any /.test(`${offer.title} ${offer.description}`.toLowerCase()) ? "Check eligible varieties, sizes, and exclusions." : "",
    ].filter(Boolean);
    const score = candidate.relevance.score / 100;
    return [{
      offer,
      score,
      status: score >= 0.9 && !warnings.length ? "strong_match" : "possible_substitute",
      reasons: candidate.relevance.evidence,
      warnings,
    }];
  });
}
