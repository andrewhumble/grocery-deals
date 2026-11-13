import { createHash } from "node:crypto";
import { discountAmount, discountPercent } from "../discount";
import { conceptsForDocument } from "./concepts";
import type { Offer } from "../types";
import type { DealDocument } from "./types";

export function offerRef(offerId: string): string {
  return `deal_${createHash("sha256").update(offerId).digest("base64url").slice(0, 16)}`;
}

export function documentForOffer(offer: Offer): DealDocument {
  const identityText = [offer.title, offer.brand, offer.description, offer.category, ...offer.sourceCategories]
    .filter(Boolean)
    .join(" ");
  return {
    ref: offerRef(offer.id),
    offerId: offer.id,
    identityText,
    title: offer.title,
    brand: offer.brand,
    description: offer.description,
    category: offer.category,
    sourceCategories: offer.sourceCategories,
    concepts: conceptsForDocument(identityText),
    retailer: offer.retailer,
    storeId: offer.storeId,
    promotionKind: offer.promotion.kind,
    couponRequired: offer.promotion.couponRequired,
    salePrice: offer.promotion.salePrice ?? null,
    regularPrice: offer.promotion.regularPrice ?? null,
    discountAmount: discountAmount(offer),
    discountPercent: discountPercent(offer),
    discountBasis: offer.promotion.discountUnitBasis ?? "each",
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    sourceUpdatedAt: offer.sourceUpdatedAt ?? null,
    proofUrl: offer.offerUrl,
  };
}
