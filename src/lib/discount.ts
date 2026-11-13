import type { Offer, Promotion } from "./types";

function positive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Dollar savings for one advertised item/deal. Weight-based savings are not comparable. */
export function discountAmount(offer: Offer): number | null {
  const promotion = offer.promotion;
  if (promotion.kind === "threshold_discount" || promotion.discountUnitBasis === "lb") return null;
  return positive(promotion.amountOff);
}

/** Effective percent saved, based only on explicit or verified comparable values. */
export function discountPercent(offer: Offer): number | null {
  const promotion = offer.promotion;
  const explicit = positive(promotion.percentOff);
  if (explicit !== null) return explicit;

  if (promotion.kind === "buy_x_get_y") {
    const buy = positive(promotion.buyQuantity);
    const get = positive(promotion.getQuantity);
    if (buy !== null && get !== null) return get / (buy + get) * 100;
  }

  const regular = positive(promotion.regularPrice);
  const sale = positive(promotion.salePrice);
  if (regular !== null && sale !== null && sale < regular) return (regular - sale) / regular * 100;
  return null;
}

export function compareDiscounts(a: Offer, b: Offer, metric: "amount" | "percent"): number {
  const value = metric === "amount" ? discountAmount : discountPercent;
  const aValue = value(a);
  const bValue = value(b);
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return bValue - aValue;
}

export function discountSortLabel(offer: Offer, metric: "amount" | "percent"): string | null {
  const value = metric === "amount" ? discountAmount(offer) : discountPercent(offer);
  if (value === null) return null;
  if (metric === "amount") return `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)} saved`;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}% off`;
}
