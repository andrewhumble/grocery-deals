export type StoreProfile = {
  publix: { storeId: string };
  costco: { warehouseId: string; label: string };
  wholeFoods: { postalCode: string; label: string };
};

export const defaultStoreProfile: StoreProfile = {
  publix: { storeId: "719" },
  costco: { warehouseId: "", label: "" },
  wholeFoods: { postalCode: "", label: "" },
};

export type SourceStatus = {
  retailer: "publix" | "costco" | "wholefoods";
  label: string;
  refreshedAt: string | null;
  detail: string;
};
