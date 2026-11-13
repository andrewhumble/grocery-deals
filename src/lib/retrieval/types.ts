import type { PromotionKind, Retailer } from "../types";

export type SearchScope = "exact" | "substitutes" | "related";

export type DealSearchRequest = {
  query: string;
  scope?: SearchScope;
  retailers?: Retailer[];
  filters?: {
    active?: boolean;
    promotionKinds?: PromotionKind[];
    couponRequired?: boolean;
    maximumPrice?: number;
  };
  sort?: "relevance" | "discount_amount" | "discount_percent";
  limit?: number;
};

export type DealDocument = {
  ref: string;
  offerId: string;
  identityText: string;
  title: string;
  brand: string | null;
  description: string;
  category: string;
  sourceCategories: string[];
  concepts: string[];
  retailer: Retailer;
  storeId: string;
  promotionKind: PromotionKind;
  couponRequired: boolean;
  salePrice: number | null;
  regularPrice: number | null;
  discountAmount: number | null;
  discountPercent: number | null;
  discountBasis: "each" | "lb" | "transaction";
  startsAt: string | null;
  endsAt: string | null;
  sourceUpdatedAt: string | null;
  proofUrl: string | null;
};

export type DealCandidate = {
  ref: string;
  title: string;
  brand: string | null;
  retailer: Retailer;
  category: string;
  proofUrl: string | null;
  pricing: {
    salePrice: number | null;
    regularPrice: number | null;
    discountAmount: number | null;
    discountPercent: number | null;
    discountBasis: "each" | "lb" | "transaction";
  };
  promotion: { kind: PromotionKind; couponRequired: boolean };
  validity: { startsAt: string | null; endsAt: string | null };
  relevance: {
    score: number;
    matchKinds: Array<"phrase" | "lexical" | "concept" | "semantic">;
    evidence: string[];
  };
};

export type DealSearchResult = {
  query: string;
  scope: SearchScope;
  indexVersion: string;
  sourceFreshness: Array<{ retailer: Retailer; sourceUpdatedAt: string | null }>;
  appliedFilters: string[];
  retrievalChannels: string[];
  retrievalComplete: boolean;
  warnings: string[];
  totalCandidates: number;
  candidates: DealCandidate[];
};

export type DealDetail = {
  ref: string;
  title: string;
  retailer: Retailer;
  storeId: string;
  category: string;
  description: string;
  pricing: DealCandidate["pricing"];
  promotion: { kind: PromotionKind; text: string; couponRequired: boolean };
  validity: { startsAt: string | null; endsAt: string | null };
  sourceUpdatedAt: string | null;
  proofUrl: string | null;
};
