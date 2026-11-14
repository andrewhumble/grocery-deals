import taxonomy from "../../data/taxonomy/grocery-concepts.json";
import { decode } from "html-entities";
import { compareDiscounts, discountAmount, discountPercent } from "./discount";
import type { Offer } from "./types";
import type { SearchScope } from "./retrieval/types";
import type { CheckCatalog } from "./deal-check-sources";

type Concept = { labels: string[]; parents: string[]; substitutes: string[]; related: string[]; domains: string[] };
const concepts: Record<string, Concept> = taxonomy;
const ignored = new Set(["a", "an", "and", "the", "of", "for", "some"]);
export function cleanDisplay(value: string): string {
  return decode(value, { level: "html5", scope: "strict" }).replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  return word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
}
export function itemTokens(value: string): string[] {
  return cleanDisplay(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).map(singular).filter(w => !ignored.has(w));
}
function phrase(words: string[], terms: string[]) {
  return terms.length > 0 && ` ${words.join(" ")} `.includes(` ${terms.join(" ")} `);
}
function identify(words: string[]): string[] {
  const hits = Object.entries(concepts).flatMap(([id, c]) => c.labels.filter(l => phrase(words, itemTokens(l))).map(l => ({ id, length: itemTokens(l).length })));
  const longest = Math.max(0, ...hits.map(h => h.length));
  return [...new Set(hits.filter(h => h.length === longest).map(h => h.id))];
}
type Tier = "phrase_in_title" | "all_terms_in_title" | "concept_label";
type MatchKind = "exact" | "substitute" | "related";

export function matchDealOffers(item: string, offers: Offer[], scope: SearchScope = "exact", now = new Date()) {
  const terms = itemTokens(item);
  const ids = identify(terms);
  const domains = ids.flatMap(id => concepts[id].domains);
  const labelWords = ids.flatMap(id => concepts[id].labels.map(itemTokens));
  const consumed = new Set(labelWords.filter(label => phrase(terms, label)).flat());
  const modifiers = terms.filter(t => !consumed.has(t));
  const ranked = offers.flatMap(offer => {
    if ((offer.startsAt && Date.parse(offer.startsAt) > now.getTime()) || (offer.endsAt && Date.parse(offer.endsAt) < now.getTime())) return [];
    const title = cleanDisplay(offer.title);
    const [name, ...qualifiers] = title.split(/,|\s+[-–—]\s+|[–—]/);
    const words = itemTokens(name);
    const warnings: string[] = [];
    const categoryText = itemTokens([offer.category, offer.department, ...offer.sourceCategories].join(" "));
    const nonFood = /\b(pet|pets|household|cleaning|health|beauty|personal care|paper|automotive)\b/i.test(categoryText.join(" ")) || /\b(cat|dog)\s+(food|treat|treats)\b/i.test(title);
    if (domains.length && nonFood) return [];
    let tier: Tier | null = null;
    let kind: MatchKind = "exact";
    let matchedTerms = terms;
    if (phrase(words, terms)) tier = "phrase_in_title";
    else if (terms.length && terms.every(t => words.includes(t))) tier = "all_terms_in_title";
    else if (modifiers.every(t => words.includes(t))) {
      const label = labelWords.find(label => phrase(words, label));
      if (label) { tier = "concept_label"; matchedTerms = label; }
      else if (ids.includes("hot_dog_bun") && offer.category === "Bakery" && !/\broll[ -]on\b/i.test(name) && concepts.bun.labels.some(l => phrase(words, itemTokens(l))) && !words.some(w => ["hamburger", "burger", "slider", "dinner", "cinnamon", "sweet", "sandwich", "paper", "garlic", "knot"].includes(w))) {
        tier = "concept_label";
        matchedTerms = words.filter(w => ["bun", "roll"].includes(w));
        warnings.push("Generic bun or roll offer: verify that hot dog varieties are eligible.");
      }
    }
    if (!tier && scope !== "exact") {
      const substituteLabels = ids.flatMap(id => concepts[id].substitutes);
      const relatedLabels = scope === "related" ? ids.flatMap(id => concepts[id].related.flatMap(r => concepts[r]?.labels ?? [])) : [];
      const substitute = substituteLabels.find(l => phrase(words, itemTokens(l)));
      const related = relatedLabels.find(l => phrase(words, itemTokens(l)));
      if (substitute || related) {
        tier = "concept_label"; kind = substitute ? "substitute" : "related";
        matchedTerms = itemTokens((substitute ?? related)!);
      } else if (scope === "related" && terms.length && terms.every(t => itemTokens(qualifiers.join(" ")).includes(t))) {
        tier = "concept_label"; kind = "related";
        warnings.push("The requested item appears only in the title qualifier, not the product name.");
      }
    }
    if (!tier) return [];
    if (kind !== "exact") warnings.push(`This is a ${kind} offer, not an exact item match.`);
    const fit = domains.some(d => itemTokens(d).some(w => categoryText.includes(w))) ? 1 : 0;
    const conflict = domains.length > 0 && /\b(pet|pets|household|cleaning|candy)\b/i.test(categoryText.join(" "));
    if (conflict || (domains.length > 0 && !fit)) warnings.push("Department differs from the requested item; verify product identity.");
    if (offer.promotion.couponRequired) warnings.push("Requires a digital coupon.");
    if (/\b(select|variet|exclud|participating|assorted)/i.test(`${title} ${offer.description} ${offer.finePrint}`)) warnings.push("Verify eligible varieties, sizes, and exclusions.");
    const rank = { phrase_in_title: 3, all_terms_in_title: 2, concept_label: 1 }[tier];
    return [{ offer, tier, kind, matchedTerms, warnings, rank, fit: conflict ? -1 : fit }];
  });
  ranked.sort((a, b) => b.rank - a.rank || b.fit - a.fit || compareDiscounts(a.offer, b.offer, "percent") || a.offer.title.localeCompare(b.offer.title) || a.offer.id.localeCompare(b.offer.id));
  return {
    interpretation: { concept: ids[0] ?? null, concepts: ids, scope },
    matches: ranked.map(({ offer, tier, kind, matchedTerms, warnings }) => ({
      ref: offer.id, retailer: offer.retailer, store: offer.storeId,
      title: cleanDisplay(offer.title), brand: offer.brand ? cleanDisplay(offer.brand) : null,
      category: cleanDisplay(offer.category), description: cleanDisplay(offer.description),
      advertisedSavingsText: offer.advertisedSavingsText,
      finePrint: offer.finePrint ? cleanDisplay(offer.finePrint) : null, size: offer.size ? cleanDisplay(offer.size) : null,
      promotion: { ...offer.promotion, text: offer.promotion.rawText },
      pricing: { salePrice: offer.promotion.salePrice ?? null, regularPrice: offer.promotion.regularPrice ?? null,
        discountAmount: discountAmount(offer), discountPercent: discountPercent(offer),
        basis: offer.promotion.unitBasis ?? "each", discountBasis: offer.promotion.discountUnitBasis ?? "each" },
      membership: offer.membership ?? null, availability: offer.availability,
      validity: { startsAt: offer.startsAt, endsAt: offer.endsAt, noPublishedEndDate: !offer.endsAt,
        text: offer.validityText ?? (offer.retailer === "costco" && !offer.endsAt ? "Current listing" : null) },
      productUrl: offer.offerUrl,
      match: { tier, kind, matchedTerms, ambiguous: warnings.length > 0 }, warnings,
    })),
  };
}

export function checkDeals(item: string, catalog: CheckCatalog, scope: SearchScope = "exact", now = new Date()) {
  const usable = new Set(catalog.sources.filter(source => !source.stale && source.state !== "unavailable").map(source => source.retailer));
  const result = matchDealOffers(item, catalog.offers.filter(offer => usable.has(offer.retailer)), scope, now);
  const degraded = catalog.sources.some(s => s.stale || s.state !== "available");
  const status: "ok" | "no_matches" | "degraded" = degraded ? "degraded" : result.matches.length ? "ok" : "no_matches";
  return { query: item, ...result, status,
    sources: catalog.sources, warnings: catalog.sources.flatMap(s => s.warnings.map(w => `${s.retailer}: ${w}`)) };
}

export type DealCheckResult = ReturnType<typeof checkDeals>;
