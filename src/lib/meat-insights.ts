import type { Offer, Retailer } from "./types";

// This is intentionally narrower than a retailer's department taxonomy. The
// question is about flexible centre-of-plate ingredients for cooking, not every
// item the retailer happens to classify under meat or seafood.
export type Protein = "chicken" | "beef" | "pork" | "sausage" | "turkey" | "lamb" | "seafood" | "other";
export type MealProteinForm = "fresh_cut" | "sausage" | "plain_seafood";

export type MeatDeal = {
  rank: number;
  score: number;
  protein: Protein;
  form: MealProteinForm;
  offer: Pick<Offer, "id" | "retailer" | "title" | "brand" | "category" | "endsAt" | "availability" | "offerUrl"> & {
    price: number | null;
    priceUnit: "each" | "lb" | null;
    promotion: string;
  };
  reasons: string[];
  cautions: string[];
};

const mealDepartments = new Set(["Meat & poultry", "Seafood"]);

// These are items a shopper would not normally choose as a flexible meal
// protein, even when the retailer puts them in its meat or seafood department.
const notMealProtein = /\b(deli|lunch meat|thin sliced|sliced|pepperoni|jerky|(?:meat )?sticks?|snack|breakfast|bites|hot dogs?|rotisserie|fully cooked|ready[- ]to[- ]eat|ready[- ]to[- ]heat|heat[- ]and[- ]eat|prepared|meal kit|entrée|entree|casserole|pizza|sandwich|burrito|taquito|nuggets?|tenders?|pot pie|soup|chili|stew|canned|platter|cocktail|includes sauce|piccata|hillshire farm naturals|plant[- ]?(?:based|rich)|meatless|vegan|vegetarian)\b/i;

const poultryOrMeat = /\b(chicken|beef|pork|turkey|lamb|veal|steak|brisket|ground (?:beef|round|chuck|sirloin|turkey|pork)|drumsticks?|thighs?|breasts?|tenderloin|chops?|cutlets?|ribeye|filet mignon|ribs?)\b/i;
const sausage = /\b(?:sausages?|bratwurst|kielbasa|andouille|chorizo)\b/i;
const plainSeafood = /\b(shrimp|prawns?|salmon|cod|tilapia|halibut|mahi(?:\s|-)?mahi|scallops?|mussels?|clams?|crab|lobster|fish fillets?)\b/i;
const convenienceSeafood = /\b(breaded|battered|popcorn|coconut|scampi|fish sticks?|fish cakes?|air[- ]fried|beer batter|southern style|garlic|herb|butter|seasoned|island lime|jammin|jerk)\b/i;

export const meatScope = "Active meal-building proteins from meat, poultry, and seafood departments: fresh cuts, sausage, and plain seafood. Costco uses its broad Grocery department plus the same product-title rules because its savings feed has no meat department. Deli meats, snacks, breakfast items, prepared meals, breaded convenience seafood, and plant-based items are excluded.";
export const meatRankingPolicy = "Ranks flexible meal-protein ingredients by retailer-published discount strength and price clarity, and shows one top deal per protein type before repeats. It is not a market-wide cheapest-price comparison.";

function positive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function regularPrice(offer: Offer): number | null {
  const fromPromotion = positive(offer.promotion.regularPrice);
  if (fromPromotion !== null) return fromPromotion;
  const match = offer.advertisedSavingsText?.match(/regularly\s*\$([\d,.]+)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formFor(title: string): MealProteinForm | null {
  if (sausage.test(title)) return "sausage";
  if (plainSeafood.test(title) && !convenienceSeafood.test(title)) return "plain_seafood";
  if (poultryOrMeat.test(title)) return "fresh_cut";
  return null;
}

function proteinFor(title: string, form: MealProteinForm): Protein {
  if (form === "sausage") return "sausage";
  if (form === "plain_seafood") return "seafood";
  if (/\bturkey\b/i.test(title)) return "turkey";
  if (/\b(chicken|drumstick|thigh|breast)\b/i.test(title)) return "chicken";
  if (/\b(lamb|veal)\b/i.test(title)) return "lamb";
  if (/\b(pork|chops?|ribs?|tenderloin)\b/i.test(title)) return "pork";
  if (/\b(beef|steak|brisket|ground round|ground chuck|ground sirloin)\b/i.test(title)) return "beef";
  return "other";
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function scoreDeal(offer: Offer, form: MealProteinForm): Omit<MeatDeal, "rank" | "protein" | "form" | "offer"> {
  const promotion = offer.promotion;
  const sale = positive(promotion.salePrice);
  const regular = regularPrice(offer);
  const reasons: string[] = [];
  const cautions: string[] = [];
  // A simple, cookable ingredient gets a modest head start over a more
  // specialized sausage, but the actual published deal remains the main rank.
  let score = form === "fresh_cut" || form === "plain_seafood" ? 25 : 20;

  if (sale !== null && regular !== null && sale < regular) {
    const percentage = Math.round((1 - sale / regular) * 100);
    score += Math.min(65, percentage * 1.25);
    reasons.push(`${percentage}% below the published regular price (${formatMoney(regular)} → ${formatMoney(sale)}).`);
  } else if (promotion.kind === "buy_x_get_y" && positive(promotion.buyQuantity) !== null && positive(promotion.getQuantity) !== null) {
    const percent = Math.round(promotion.getQuantity! / (promotion.buyQuantity! + promotion.getQuantity!) * 100);
    score += Math.min(60, percent * 1.2);
    reasons.push(`Buy ${promotion.buyQuantity}, get ${promotion.getQuantity} free (about ${percent}% off when all qualifying items are purchased).`);
  } else if (positive(promotion.percentOff) !== null) {
    score += Math.min(60, promotion.percentOff! * 1.2);
    reasons.push(`${promotion.percentOff}% off.`);
  } else if (positive(promotion.amountOff) !== null) {
    const unit = promotion.discountUnitBasis === "lb" ? "/lb" : "";
    score += promotion.discountUnitBasis === "lb" ? 30 : 22;
    reasons.push(`Save ${formatMoney(promotion.amountOff!)}${unit}.`);
    cautions.push("The source does not publish a comparable regular price, so the percentage discount is unknown.");
  } else {
    cautions.push("The source publishes a sale price but no explicit savings amount or regular price.");
  }

  if (sale !== null) {
    score += 8;
    reasons.push(`Published sale price: ${formatMoney(sale)}${promotion.unitBasis === "lb" ? "/lb" : ""}.`);
  } else {
    cautions.push("The final price depends on the promotion terms or is not published.");
  }
  if (promotion.couponRequired) {
    score -= 12;
    cautions.push("Requires a coupon.");
  }
  if (promotion.kind === "threshold_discount") {
    score -= 10;
    cautions.push("Requires a minimum purchase.");
  }
  if (offer.endsAt === null) cautions.push("No end date was published; verify current availability.");

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, cautions };
}

export function isMealProteinOffer(offer: Offer): boolean {
  const eligibleDepartment = mealDepartments.has(offer.category)
    || (offer.retailer === "costco" && offer.department === "Grocery");
  if (!eligibleDepartment) return false;
  const identity = [offer.title, offer.brand].filter(Boolean).join(" ");
  const form = formFor(identity);
  if (!form || notMealProtein.test(identity)) return false;
  // Cured and smoked ham steaks are closer to deli/ready-to-heat products than
  // flexible cooking ingredients. Sausage remains included by explicit choice.
  return form === "sausage" || !/\b(ham|smoked|cured|golden brown)\b/i.test(identity);
}

export function bestMeatDeals(offers: Offer[], retailer?: Retailer, limit = 10): MeatDeal[] {
  const candidates = offers
    .filter((offer) => !retailer || offer.retailer === retailer)
    .filter(isMealProteinOffer)
    .map((offer) => {
      const form = formFor(`${offer.title} ${offer.brand ?? ""}`)!;
      const assessment = scoreDeal(offer, form);
      return {
        ...assessment,
        rank: 0,
        protein: proteinFor(offer.title, form),
        form,
        offer: {
          id: offer.id,
          retailer: offer.retailer,
          title: offer.title,
          brand: offer.brand,
          category: offer.category,
          endsAt: offer.endsAt,
          availability: offer.availability,
          offerUrl: offer.offerUrl,
          price: offer.promotion.salePrice ?? null,
          priceUnit: offer.promotion.unitBasis ?? null,
          promotion: offer.promotion.rawText,
        },
      };
    })
    .sort((left, right) => right.score - left.score || left.offer.title.localeCompare(right.offer.title));

  const seenTitles = new Set<string>();
  const uniqueCandidates = candidates
    .filter((deal) => {
      const key = `${deal.offer.retailer}:${deal.offer.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });

  // When several items have the same promotion (especially BOGO), alphabetical
  // ordering is not a useful definition of "best." Surface a useful set of
  // meal options before showing a second deal for the same protein type.
  const representedProteins = new Set<Protein>();
  const varied = uniqueCandidates.filter((deal) => {
    if (representedProteins.has(deal.protein)) return false;
    representedProteins.add(deal.protein);
    return true;
  });
  const remaining = uniqueCandidates.filter((deal) => !varied.includes(deal));
  return [...varied, ...remaining]
    .slice(0, Math.min(Math.max(limit, 1), 25))
    .map((deal, index) => ({ ...deal, rank: index + 1 }));
}
