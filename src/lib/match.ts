import type { GroceryMatch, Offer } from "./types";
import { offerSearchScore, searchTerms } from "./search";

const ignored = new Set(["a", "an", "and", "for", "of", "the", "to", "with", "my", "some"]);

function words(value: string): string[] {
  return searchTerms(value.replace(/^\s*\d+(?:\.\d+)?\s*(?:x|lb|oz|ct|pack|pk)?\s*/i, "")).filter((word) => !ignored.has(word));
}

function scoreOffer(item: string, offer: Offer): GroceryMatch | null {
  const itemWords = words(item);
  if (itemWords.length === 0) return null;

  const title = offer.title.toLowerCase();
  const exactTitle = title.includes(item.toLowerCase().trim());
  const titleHits = itemWords.filter((word) => title.includes(word));
  const searchScore = offerSearchScore(offer, itemWords.join(" "));
  if (searchScore === null) return null;
  // Keep the underlying identity-search ordering intact. The previous formula
  // saturated at 1.0, making an egg candy tie with an actual egg offer.
  const score = Math.min(0.98, 0.3 + searchScore / 100);

  if (score < 0.45) return null;

  const reasons = [
    exactTitle ? "The offer title directly names this item." : `Matches ${titleHits.join(", ")} in the product title or source category.`,
    offer.category ? `Filed under ${offer.category}.` : "",
  ].filter(Boolean);
  const warnings = [
    offer.promotion.couponRequired ? "Requires a manufacturer digital coupon." : "",
    /exclud|select|participating|any /.test(`${offer.title} ${offer.description}`.toLowerCase())
      ? "Check eligible varieties, sizes, and exclusions."
      : "",
  ].filter(Boolean);

  return {
    offer,
    score,
    status: score >= 0.95 && !warnings.length ? "strong_match" : "possible_substitute",
    reasons,
    warnings,
  };
}

export function matchGroceryItem(item: string, offers: Offer[]): GroceryMatch[] {
  return offers
    .map((offer) => scoreOffer(item, offer))
    .filter((match): match is GroceryMatch => match !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function groceryLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
}
