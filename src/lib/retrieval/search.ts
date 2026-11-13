import "server-only";

import { isActive } from "../deals";
import { normalizeSearchText } from "../normalize";
import { searchTerms } from "../search";
import { conceptLabels, queryConcepts } from "./concepts";
import { ensureDealIndex, ftsMatches, indexDocuments, indexStatus } from "./index";
import type { DealCandidate, DealDocument, DealSearchRequest, DealSearchResult, SearchScope } from "./types";

type CandidateScore = { document: DealDocument; score: number; kinds: Set<DealCandidate["relevance"]["matchKinds"][number]>; evidence: Set<string> };

function safeScope(value: unknown): SearchScope {
  return value === "substitutes" || value === "related" ? value : "exact";
}

function ftsQuery(query: string): string {
  return searchTerms(query).map((term) => `"${term.replace(/"/g, "")}"${term.length >= 3 ? "*" : ""}`).join(" AND ");
}

function addCandidate(candidates: Map<string, CandidateScore>, document: DealDocument, score: number, kind: CandidateScore["kinds"] extends Set<infer Kind> ? Kind : never, evidence: string) {
  const current = candidates.get(document.ref) ?? { document, score: 0, kinds: new Set(), evidence: new Set() };
  current.score += score;
  current.kinds.add(kind);
  current.evidence.add(evidence);
  candidates.set(document.ref, current);
}

function passesFilters(document: DealDocument, request: DealSearchRequest): boolean {
  const filters = request.filters ?? {};
  if (request.retailers?.length && !request.retailers.includes(document.retailer)) return false;
  if (filters.active !== false && !isActive({ startsAt: document.startsAt, endsAt: document.endsAt } as Parameters<typeof isActive>[0])) return false;
  if (filters.promotionKinds?.length && !filters.promotionKinds.includes(document.promotionKind)) return false;
  if (typeof filters.couponRequired === "boolean" && document.couponRequired !== filters.couponRequired) return false;
  if (typeof filters.maximumPrice === "number" && (document.salePrice === null || document.salePrice > filters.maximumPrice)) return false;
  return true;
}

function candidateFrom(score: CandidateScore): DealCandidate {
  const document = score.document;
  return {
    ref: document.ref,
    title: document.title,
    brand: document.brand,
    retailer: document.retailer,
    category: document.category,
    proofUrl: document.proofUrl,
    pricing: {
      salePrice: document.salePrice,
      regularPrice: document.regularPrice,
      discountAmount: document.discountAmount,
      discountPercent: document.discountPercent,
      discountBasis: document.discountBasis,
    },
    promotion: { kind: document.promotionKind, couponRequired: document.couponRequired },
    validity: { startsAt: document.startsAt, endsAt: document.endsAt },
    relevance: { score: Number(Math.min(score.score, 100).toFixed(2)), matchKinds: [...score.kinds], evidence: [...score.evidence] },
  };
}

function sortCandidates(candidates: DealCandidate[], sort: DealSearchRequest["sort"]): DealCandidate[] {
  return candidates.sort((a, b) => {
    if (sort === "discount_amount") return (b.pricing.discountAmount ?? -1) - (a.pricing.discountAmount ?? -1) || b.relevance.score - a.relevance.score;
    if (sort === "discount_percent") return (b.pricing.discountPercent ?? -1) - (a.pricing.discountPercent ?? -1) || b.relevance.score - a.relevance.score;
    return b.relevance.score - a.relevance.score || a.title.localeCompare(b.title);
  });
}

export async function searchDealCandidates(request: DealSearchRequest): Promise<DealSearchResult> {
  const query = request.query.trim();
  const scope = safeScope(request.scope);
  if (!query) throw new Error("query is required.");
  const status = await ensureDealIndex();
  const documents = indexDocuments().filter((document) => passesFilters(document, request));
  const candidates = new Map<string, CandidateScore>();
  const normalizedQuery = normalizeSearchText(query);
  const terms = searchTerms(query);
  const concepts = queryConcepts(query, scope);

  for (const document of documents) {
    const identity = normalizeSearchText(document.identityText);
    if (identity.includes(normalizedQuery)) addCandidate(candidates, document, 100, "phrase", `Exact phrase in product identity: ${query}`);

    const matchedTerms = terms.filter((term) => identity.split(" ").some((word) => word === term || (term.length >= 3 && word.startsWith(term))));
    if (matchedTerms.length) addCandidate(candidates, document, 30 * matchedTerms.length / terms.length, "lexical", `Product text matches: ${matchedTerms.join(", ")}`);

    const sharedConcepts = document.concepts.filter((concept) => concepts.has(concept));
    if (sharedConcepts.length) {
      const labels = sharedConcepts.flatMap(conceptLabels).slice(0, 3);
      addCandidate(candidates, document, 45 + sharedConcepts.length * 5, "concept", `Grocery concept: ${labels.join(", ")}`);
    }
  }

  const documentsByRef = new Map(documents.map((document) => [document.ref, document]));
  for (const [position, match] of ftsMatches(ftsQuery(query), 100).entries()) {
    const document = documentsByRef.get(match.ref);
    if (document) addCandidate(candidates, document, 25 / (position + 1), "lexical", "Full-text product search");
  }

  const appliedFilters = [request.filters?.active === false ? "include inactive" : "active now"];
  if (request.retailers?.length) appliedFilters.push(`retailers: ${request.retailers.join(", ")}`);
  if (request.filters?.promotionKinds?.length) appliedFilters.push(`promotion: ${request.filters.promotionKinds.join(", ")}`);
  if (typeof request.filters?.couponRequired === "boolean") appliedFilters.push(request.filters.couponRequired ? "coupon required" : "no coupon required");
  if (typeof request.filters?.maximumPrice === "number") appliedFilters.push(`price <= $${request.filters.maximumPrice}`);

  const result = sortCandidates([...candidates.values()].map(candidateFrom), request.sort ?? "relevance");
  const limit = Math.min(Math.max(request.limit ?? 12, 1), 25);
  return {
    query,
    scope,
    indexVersion: status.version,
    sourceFreshness: status.sourceFreshness,
    appliedFilters,
    retrievalChannels: ["exact phrase", "prefix lexical", "SQLite full-text", "grocery concepts"],
    retrievalComplete: true,
    warnings: status.documentCount === 0 ? ["The retrieval index is empty."] : [],
    totalCandidates: result.length,
    candidates: result.slice(0, limit),
  };
}
