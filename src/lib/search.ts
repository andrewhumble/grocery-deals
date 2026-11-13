import type { Offer } from "./types";

export function searchTerms(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function productTerms(offer: Offer): { all: string[]; title: string[] } {
  const title = searchTerms(offer.title);
  // Keep matching focused on product identity. Descriptions and fine print
  // are useful context, but can make unrelated offers match a grocery item.
  return {
    title,
    all: [...title, ...searchTerms(offer.brand ?? ""), ...searchTerms(offer.department ?? ""), ...offer.sourceCategories.flatMap(searchTerms)],
  };
}

function matchesWord(queryTerm: string, productWord: string): boolean {
  // Prefix matching makes an in-progress query useful: "chick" finds
  // "chicken". Exact matching covers short terms without widening them.
  return productWord === queryTerm || (queryTerm.length >= 3 && productWord.startsWith(queryTerm));
}

/** Returns a sortable score, or null when an offer is not a product match. */
export function offerSearchScore(offer: Offer, query: string): number | null {
  const queryTerms = searchTerms(query);
  if (queryTerms.length === 0) return 0;
  if (queryTerms.length === 1 && queryTerms[0] === "bogo") return offer.promotion.kind === "buy_x_get_y" ? 100 : null;

  const fields = productTerms(offer);
  if (!queryTerms.every((queryTerm) => fields.all.some((word) => matchesWord(queryTerm, word)))) return null;

  const titleMatches = queryTerms.filter((queryTerm) => fields.title.some((word) => matchesWord(queryTerm, word))).length;
  const phrase = queryTerms.join(" ");
  const titlePhrase = fields.title.join(" ");
  return titleMatches * 10 + (titlePhrase.includes(phrase) ? 20 : 0);
}

export function matchesOfferSearch(offer: Offer, query: string): boolean {
  return offerSearchScore(offer, query) !== null;
}
