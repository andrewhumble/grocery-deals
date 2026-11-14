export type PromotionKind =
  | "unit_price"
  | "multi_buy"
  | "buy_x_get_y"
  | "amount_off"
  | "percent_off"
  | "threshold_discount"
  | "unknown";

export type Retailer = "publix" | "costco" | "wholefoods";

export type RawPublixSaving = {
  id: string;
  title: string;
  description?: string | null;
  savings: string;
  additionalSavings?: string | null;
  additionalDealInfo?: string | null;
  finePrint?: string | null;
  Terms?: string | null;
  imageUrl?: string | null;
  enhancedImageUrl?: string | null;
  brand?: string | null;
  department?: string | null;
  categories?: string[] | null;
  wa_startDate: string;
  wa_endDate: string;
  savingType?: string | null;
  wa_promotionType?: string | null;
  wa_baseProductId_s?: string | null;
  wa_itemCode?: number | null;
  baseProductId?: string | null;
  finalPrice?: number | null;
  originalDeal?: number | null;
  promoTotalSavings?: number | null;
  dc_startDate?: string | null;
  dc_endDate?: string | null;
  minimumPurchase?: number | null;
  [key: string]: unknown;
};

export type RawPublixResponse = {
  WeeklyAdLatestUpdatedDateTime?: string;
  Savings: RawPublixSaving[];
};

export type RawPublixProductSnapshot = {
  retrievedAt?: string;
  storeId?: string;
  promotions?: RawPublixResponse;
  products?: RawPublixSaving[];
  eligiblePromotionIds?: string[];
};

export type Promotion = {
  rawText: string;
  kind: PromotionKind;
  salePrice?: number;
  regularPrice?: number;
  unitBasis?: "each" | "lb";
  bundleQuantity?: number;
  bundlePrice?: number;
  buyQuantity?: number;
  getQuantity?: number;
  amountOff?: number;
  discountUnitBasis?: "each" | "lb" | "transaction";
  percentOff?: number;
  minimumSpend?: number;
  couponRequired: boolean;
};

export type Offer = {
  size?: string;
  membership?: { program: string; price: number; memberOnly: true };
  id: string;
  retailer: Retailer;
  storeId: string;
  sourceUpdatedAt?: string;
  title: string;
  description: string;
  brand: string | null;
  department: string | null;
  sourceCategories: string[];
  category: string;
  imageUrl: string | null;
  promotion: Promotion;
  advertisedSavingsText: string | null;
  finePrint: string | null;
  startsAt: string | null;
  endsAt: string | null;
  validityText: string | null;
  availability: string | null;
  offerUrl: string | null;
  searchableText: string;
  source: {
    offerId: string;
    baseProductId: string | null;
    itemCode: number | null;
    savingType: string | null;
    promotionType: string | null;
  };
};

export type GroceryMatch = {
  offer: Offer;
  score: number;
  status: "strong_match" | "possible_substitute";
  reasons: string[];
  warnings: string[];
};
