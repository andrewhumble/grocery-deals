import assert from "node:assert/strict";
import test from "node:test";
import { loadDeals } from "../src/lib/deals";
import { dealDetails } from "../src/lib/retrieval/details";
import { matchGroceryItemFromIndex } from "../src/lib/retrieval/list-match";
import { searchDealCandidates } from "../src/lib/retrieval/search";

test("retrieves the active Publix BOGO hot-dog buns with proof-capable references", async () => {
  const result = await searchDealCandidates({
    query: "hot dog buns",
    scope: "exact",
    retailers: ["publix"],
    filters: { active: true, promotionKinds: ["buy_x_get_y"] },
  });

  assert.equal(result.retrievalComplete, true);
  assert.ok(result.candidates.some((candidate) => candidate.title === "Nature's Own Perfectly Crafted Brioche Style Hot Dog Buns"));
  assert.ok(result.candidates.some((candidate) => candidate.title === "Wonder Enriched Classic Hot Dog Buns"));
  assert.ok(!result.candidates.some((candidate) => /hot dogs|franks|wieners/i.test(candidate.title) && !/hot dog buns/i.test(candidate.title)));

  const bunRefs = result.candidates.filter((candidate) => /hot dog buns/i.test(candidate.title)).map((candidate) => candidate.ref);
  const details = await dealDetails(bunRefs);
  assert.equal(details.missingRefs.length, 0);
  assert.ok(details.deals.every((deal) => deal.proofUrl?.startsWith("https://www.publix.com/pd/")));
});

test("bread retrieves descendant bakery concepts without needing an exact title phrase", async () => {
  const result = await searchDealCandidates({ query: "bread", scope: "substitutes", filters: { active: true }, limit: 25 });
  assert.ok(result.candidates.some((candidate) => /bagel|bun|roll|bread/i.test(candidate.title)));
  assert.ok(result.candidates.some((candidate) => candidate.relevance.matchKinds.includes("concept")));
});

test("persisted grocery-list matching uses the shared retrieval service", async () => {
  const matches = await matchGroceryItemFromIndex("hot dog buns", await loadDeals());
  assert.ok(matches.some((match) => match.offer.title === "Wonder Enriched Classic Hot Dog Buns"));
  assert.ok(matches.every((match) => match.reasons.length > 0));
});
