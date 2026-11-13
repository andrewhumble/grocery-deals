"use client";

import { useMemo, useState } from "react";
import { groceryLines, matchGroceryItem } from "@/lib/match";
import { compareDiscounts, discountSortLabel } from "@/lib/discount";
import { promotionLabel } from "@/lib/normalize";
import { offerSearchScore } from "@/lib/search";
import type { Offer } from "@/lib/types";
import type { SourceStatus, StoreProfile } from "@/lib/profile-types";

type Tab = "deals" | "list" | "settings";
type SortOption = "relevance" | "discount_amount" | "discount_percent";
const displayLimit = 48;

function dealDate(iso: string | null) {
  if (!iso) return "Current listing";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(iso));
}

function isActive(offer: Offer) {
  const now = new Date();
  return (!offer.startsAt || new Date(offer.startsAt) <= now) && (!offer.endsAt || now <= new Date(offer.endsAt));
}

function retailerName(retailer: Offer["retailer"]) {
  if (retailer === "costco") return "Costco";
  if (retailer === "wholefoods") return "Whole Foods";
  return "Publix";
}

function availabilityLabel(availability: Offer["availability"]) {
  if (availability === "warehouse_only") return "Warehouse";
  if (availability === "warehouse_online") return "Warehouse + online";
  if (availability === "online_only") return "Online only";
  if (availability === "in_stock") return "In stock";
  return null;
}

function priceLabel(offer: Offer) {
  if (typeof offer.promotion.salePrice !== "number") return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(offer.promotion.salePrice);
}

function promotionDetail(offer: Offer, price: string | null) {
  const raw = offer.promotion.rawText.trim();
  if (!price) return raw;
  const escapedPrice = price.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw
    .replace(new RegExp(`^(?:(?:current|sale)\\s+price\\s*:?\\s*)?${escapedPrice}\\s*(?:[·•—–-]\\s*)?`, "i"), "")
    .trim();
}

function DealCard({ offer, sort }: { offer: Offer; sort: SortOption }) {
  const price = priceLabel(offer);
  const dealDetail = promotionDetail(offer, price);
  const sortMetric = sort === "discount_amount" ? discountSortLabel(offer, "amount") : sort === "discount_percent" ? discountSortLabel(offer, "percent") : null;
  return (
    <article className="deal-card">
      <div className="deal-image-wrap">
        {offer.imageUrl ? <img className="deal-image" src={offer.imageUrl} alt="" /> : <div className="image-fallback">Deal</div>}
      </div>
      <div className="deal-copy">
        <div className="deal-kickers">
          <span className={`retailer ${offer.retailer}`}>{retailerName(offer.retailer)}</span>
          <span className={`pill ${offer.promotion.kind}`}>{promotionLabel(offer.promotion.kind)}</span>
          {offer.promotion.couponRequired && <span className="coupon">Digital coupon</span>}
        </div>
        <h3>{offer.offerUrl ? <a className="product-link" href={offer.offerUrl} target="_blank" rel="noreferrer">{offer.title}</a> : offer.title}</h3>
        {sortMetric && <p className="discount-metric">{sortMetric}</p>}
        {price ? <p className="deal-price">{price}</p> : null}
        {dealDetail && <p className="promotion-detail">{dealDetail}</p>}
        {offer.description && <p className="description">{offer.description}</p>}
        <div className="deal-footer">
          <span>{availabilityLabel(offer.availability) ?? offer.category}</span>
          <span>{offer.endsAt ? `Ends ${dealDate(offer.endsAt)}` : "Current listing"}</span>
        </div>
      </div>
    </article>
  );
}

export function DealsDashboard({ offers, initialProfile, sourceStatuses }: { offers: Offer[]; initialProfile: StoreProfile; sourceStatuses: SourceStatus[] }) {
  const [tab, setTab] = useState<Tab>("deals");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [retailer, setRetailer] = useState("All");
  const [dealType, setDealType] = useState("All");
  const [sort, setSort] = useState<SortOption>("relevance");
  const [couponsOnly, setCouponsOnly] = useState(false);
  const [showActive, setShowActive] = useState(false);
  const [list, setList] = useState("milk\nsandwich bread\nchicken breasts\ncoffee");
  const [shown, setShown] = useState(displayLimit);
  const [profile, setProfile] = useState(initialProfile);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const categories = useMemo(() => ["All", ...Array.from(new Set(offers.map((offer) => offer.category))).sort()], [offers]);
  const retailerCounts = useMemo(() => ({
    publix: offers.filter((offer) => offer.retailer === "publix").length,
    costco: offers.filter((offer) => offer.retailer === "costco").length,
    wholefoods: offers.filter((offer) => offer.retailer === "wholefoods").length,
  }), [offers]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return offers.map((offer) => ({ offer, score: normalizedQuery ? offerSearchScore(offer, normalizedQuery) : 0 })).filter(({ offer, score }) => {
      if (normalizedQuery && score === null) return false;
      if (category !== "All" && offer.category !== category) return false;
      if (retailer !== "All" && offer.retailer !== retailer) return false;
      if (dealType !== "All" && offer.promotion.kind !== dealType) return false;
      if (couponsOnly && !offer.promotion.couponRequired) return false;
      if (showActive && !isActive(offer)) return false;
      return true;
    }).sort((a, b) => {
      if (sort === "discount_amount") {
        const difference = compareDiscounts(a.offer, b.offer, "amount");
        if (difference) return difference;
      }
      if (sort === "discount_percent") {
        const difference = compareDiscounts(a.offer, b.offer, "percent");
        if (difference) return difference;
      }
      const relevanceDifference = (b.score ?? 0) - (a.score ?? 0);
      return relevanceDifference || a.offer.title.localeCompare(b.offer.title) || a.offer.id.localeCompare(b.offer.id);
    }).map(({ offer }) => offer);
  }, [offers, query, category, retailer, dealType, sort, couponsOnly, showActive]);
  const listMatches = useMemo(() => groceryLines(list).map((item) => ({ item, matches: matchGroceryItem(item, offers) })), [list, offers]);
  const activeCount = offers.filter(isActive).length;

  function resetFilters() {
    setQuery("");
    setCategory("All");
    setRetailer("All");
    setDealType("All");
    setSort("relevance");
    setCouponsOnly(false);
    setShowActive(false);
    setShown(displayLimit);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingProfile(true);
    setProfileMessage(null);
    try {
      const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      if (!response.ok) throw new Error("Could not save your store profile.");
      const result = await response.json() as { profile: StoreProfile };
      setProfile(result.profile);
      setProfileMessage("Saved. Run refresh:all to retrieve deals for the selected Publix store.");
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Could not save your store profile.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  return (
    <main>
      <header className="masthead">
        <div>
          <p className="eyebrow">Local grocery intelligence</p>
          <h1>Pantry Signal</h1>
          <p className="subtitle">Search local Publix, Costco, and Whole Foods savings, then see what might cover your grocery list.</p>
        </div>
        <div className="store-context">
          <span className="status-dot" />
          <div><strong>Publix Store {profile.publix.storeId} + Costco + Whole Foods</strong><small>{activeCount} current listings · {retailerCounts.publix} Publix · {retailerCounts.costco} Costco · {retailerCounts.wholefoods} Whole Foods</small></div>
        </div>
      </header>

      <nav className="tabs" aria-label="App sections">
        <button className={tab === "deals" ? "active" : ""} onClick={() => setTab("deals")}>Browse deals</button>
        <button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")}>Match my list</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Sources & stores</button>
      </nav>

      {tab === "deals" ? (
        <section>
          <div className="filters">
            <label className="search"><span>Search</span><input value={query} onChange={(event) => { setQuery(event.target.value); setShown(displayLimit); }} placeholder="Try coffee, chicken, BOGO…" /></label>
            <label><span>Source</span><select value={retailer} onChange={(event) => { setRetailer(event.target.value); setShown(displayLimit); }}><option value="All">All sources</option><option value="publix">Publix</option><option value="costco">Costco</option><option value="wholefoods">Whole Foods</option></select></label>
            <label><span>Department</span><select value={category} onChange={(event) => { setCategory(event.target.value); setShown(displayLimit); }}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Promotion</span><select value={dealType} onChange={(event) => { setDealType(event.target.value); setShown(displayLimit); }}><option value="All">All promotions</option><option value="buy_x_get_y">BOGO</option><option value="multi_buy">Multi-buy</option><option value="unit_price">Sale price</option><option value="amount_off">Amount off</option><option value="percent_off">Percent off</option><option value="threshold_discount">Spend & save</option></select></label>
            <label><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value as SortOption); setShown(displayLimit); }}><option value="relevance">Relevance</option><option value="discount_amount">Discount amount ($)</option><option value="discount_percent">Discount amount (%)</option></select></label>
            <label className="toggle"><input type="checkbox" checked={couponsOnly} onChange={(event) => setCouponsOnly(event.target.checked)} /> Coupon required</label>
            <label className="toggle"><input type="checkbox" checked={showActive} onChange={(event) => setShowActive(event.target.checked)} /> Current listings</label>
            <button className="reset" onClick={resetFilters}>Reset</button>
          </div>

          <div className="result-bar"><span><strong>{filtered.length}</strong> listings found</span><span>Product prices and promotion terms are shown exactly as supplied by each retailer.</span></div>
          {filtered.length ? <div className="deal-grid">{filtered.slice(0, shown).map((offer) => <DealCard key={offer.id} offer={offer} sort={sort} />)}</div> : <div className="empty">No offers match those filters. Try a broader search.</div>}
          {shown < filtered.length && <button className="load-more" onClick={() => setShown((value) => value + displayLimit)}>Show more deals</button>}
        </section>
      ) : tab === "list" ? (
        <section className="matcher">
          <div className="matcher-intro"><p className="eyebrow">Grocery-list matcher</p><h2>Find deals worth considering.</h2><p>Matches are suggestions, not substitutions. Exact offer wording, sizes, exclusions, and coupons stay visible.</p></div>
          <label className="list-input"><span>One item per line or comma-separated</span><textarea value={list} onChange={(event) => setList(event.target.value)} rows={8} /></label>
          <div className="match-results">
            {listMatches.map(({ item, matches }) => <section className="list-result" key={item}>
              <h3>{item}</h3>
              {matches.length ? matches.map((match) => <div className="match" key={match.offer.id}>
                <div><span className={`match-status ${match.status}`}>{match.status === "strong_match" ? "Strong match" : "Possible substitute"}</span><h4>{match.offer.title}</h4><p className="promotion">{match.offer.promotion.rawText}</p><p className="match-reason">{match.reasons.join(" ")}</p>{match.warnings.map((warning) => <p className="warning" key={warning}>Note: {warning}</p>)}</div>
                <span className="match-date">{retailerName(match.offer.retailer)} · {match.offer.endsAt ? `Ends ${dealDate(match.offer.endsAt)}` : "Current listing"}</span>
              </div>) : <p className="no-match">No credible offer match found this week.</p>}
            </section>)}
          </div>
        </section>
      ) : (
        <section className="settings">
          <div className="settings-intro"><p className="eyebrow">Source profile</p><h2>Your stores and refresh cadence.</h2><p>These preferences stay in this local app. Publix uses the selected store immediately on its next refresh.</p></div>
          <form className="profile-form" onSubmit={saveProfile}>
            <label><span>Publix store number</span><input inputMode="numeric" value={profile.publix.storeId} onChange={(event) => setProfile((value) => ({ ...value, publix: { storeId: event.target.value } }))} required /></label>
            <label><span>Costco warehouse number</span><input value={profile.costco.warehouseId} onChange={(event) => setProfile((value) => ({ ...value, costco: { ...value.costco, warehouseId: event.target.value } }))} placeholder="Optional" /></label>
            <label><span>Costco warehouse label</span><input value={profile.costco.label} onChange={(event) => setProfile((value) => ({ ...value, costco: { ...value.costco, label: event.target.value } }))} placeholder="Optional, e.g. Brookhaven" /></label>
            <label><span>Whole Foods ZIP code</span><input inputMode="numeric" value={profile.wholeFoods.postalCode} onChange={(event) => setProfile((value) => ({ ...value, wholeFoods: { ...value.wholeFoods, postalCode: event.target.value } }))} placeholder="Optional" /></label>
            <label><span>Whole Foods location label</span><input value={profile.wholeFoods.label} onChange={(event) => setProfile((value) => ({ ...value, wholeFoods: { ...value.wholeFoods, label: event.target.value } }))} placeholder="Optional, e.g. Ponce de Leon" /></label>
            <div className="profile-actions"><button type="submit" className="save-profile" disabled={isSavingProfile}>{isSavingProfile ? "Saving…" : "Save profile"}</button>{profileMessage && <span className="profile-message">{profileMessage}</span>}</div>
          </form>
          <aside className="profile-note"><strong>Current source scope</strong><p>Costco and Whole Foods preferences are saved now. Their current feeds are national/online deal feeds; a location-aware retrieval adapter is the next step before those preferences change availability or pricing.</p></aside>
          <div className="refresh-panel"><div><p className="eyebrow">Freshness</p><h3>Source refresh status</h3></div><code>npm run refresh:all</code>
            <div className="source-statuses">{sourceStatuses.map((status) => <div className="source-status" key={status.retailer}><span className={`retailer ${status.retailer}`}>{status.label}</span><div><strong>{status.refreshedAt ? `Updated ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(status.refreshedAt))}` : "Not yet refreshed"}</strong><small>{status.detail}</small></div></div>)}</div>
            <p className="schedule-help">For automatic daily refresh on macOS: <code>npm run schedule:daily</code>. It creates a LaunchAgent and prints the one-time activation command.</p>
          </div>
        </section>
      )}
    </main>
  );
}
