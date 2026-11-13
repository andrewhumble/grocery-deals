import "server-only";

import { loadDeals } from "../deals";
import { loadStoreProfile } from "../profile";
import { ensureDealIndex, indexDocuments, indexStatus } from "./index";
import type { DealDetail } from "./types";

export async function dealDetails(refs: string[]): Promise<{ indexVersion: string; deals: DealDetail[]; missingRefs: string[] }> {
  await ensureDealIndex();
  const documentsByRef = new Map(indexDocuments().map((document) => [document.ref, document]));
  const documents = refs.map((ref) => documentsByRef.get(ref)).filter((document): document is NonNullable<typeof document> => Boolean(document));
  const offersById = new Map((await loadDeals(await loadStoreProfile())).map((offer) => [offer.id, offer]));
  const deals = documents.flatMap((document) => {
    const offer = offersById.get(document.offerId);
    if (!offer) return [];
    return [{
      ref: document.ref,
      title: document.title,
      retailer: document.retailer,
      storeId: document.storeId,
      category: document.category,
      description: offer.description,
      pricing: {
        salePrice: document.salePrice,
        regularPrice: document.regularPrice,
        discountAmount: document.discountAmount,
        discountPercent: document.discountPercent,
        discountBasis: document.discountBasis,
      },
      promotion: { kind: offer.promotion.kind, text: offer.promotion.rawText, couponRequired: offer.promotion.couponRequired },
      validity: { startsAt: document.startsAt, endsAt: document.endsAt },
      sourceUpdatedAt: document.sourceUpdatedAt,
      proofUrl: document.proofUrl,
    }];
  });
  return {
    indexVersion: indexStatus().version,
    deals,
    missingRefs: refs.filter((ref) => !documentsByRef.has(ref)),
  };
}
