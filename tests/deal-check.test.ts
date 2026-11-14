import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/deal-check.json";
import { checkDeals, matchDealOffers, cleanDisplay } from "../src/lib/deal-check";
import { loadDealCheckCatalog, type SnapshotReader } from "../src/lib/deal-check-sources";
import { GET as matchGET } from "../app/api/deals/match/route";
import { GET as dealsGET } from "../app/api/deals/route";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const now = new Date(fixture.now);
const reader: SnapshotReader = async pathname => structuredClone(pathname.includes("publix") ? fixture.publix : pathname.includes("wholefoods") ? fixture.wholefoods : fixture.costco);
const catalog = () => loadDealCheckCatalog("719", { reader, now, useBlob: false });

test("exact matches preserve specificity, aliases, modifiers and qualifier boundaries", async () => {
  const { offers } = await catalog();
  const eggs = matchDealOffers("eggs", offers, "exact", now).matches;
  assert.equal(eggs[0].ref, "publix:719:eggs");
  assert.ok(!eggs.some(m => m.ref.endsWith("condiment")));
  assert.ok(eggs.find(m => m.ref.endsWith("dye"))?.match.ambiguous);
  assert.equal(matchDealOffers("chicken thighs", offers, "exact", now).matches.length, 0);
  const base = offers[0];
  const thighs = { ...base, id: "thighs", title: "Just Bare Bone-In Skin-On Chicken Thighs", category: "Meat & poultry" };
  const generic = { ...thighs, id: "chicken", title: "Whole Chicken" };
  assert.deepEqual(matchDealOffers("chicken thighs", [generic, thighs], "exact", now).matches.map(m => m.ref), ["thighs"]);
  assert.equal(matchDealOffers("boneless chicken thighs", [thighs], "exact", now).matches.length, 0);
  const buns = matchDealOffers("hot dog buns", offers, "exact", now).matches;
  assert.deepEqual(buns.map(m => m.ref), ["publix:719:buns", "publix:719:rolls"]);
  assert.ok(buns[1].warnings.some(w => w.includes("Generic bun")));
  assert.equal(matchDealOffers("gluten free hot dog buns", offers, "exact", now).matches.length, 0);
  assert.ok(matchDealOffers("eggs", offers, "related", now).matches.find(m => m.ref.endsWith("condiment"))?.match.kind === "related");
  assert.ok(!matchDealOffers("hot dog buns", offers, "substitutes", now).matches.some(m => m.ref.endsWith("dogs")));
  assert.equal(matchDealOffers("hot dog buns", offers, "related", now).matches.find(m => m.ref.endsWith("dogs"))?.match.kind, "related");
  const sandwich = { ...base, id: "sandwich", title: "Sandwich Rolls" };
  assert.equal(matchDealOffers("hot dog buns", [sandwich], "exact", now).matches.length, 0);
  assert.equal(matchDealOffers("hot dog buns", [sandwich], "substitutes", now).matches[0].match.kind, "substitute");
});

test("whole tokens, display cleaning, active dates and deterministic ordering", async () => {
  assert.equal(cleanDisplay("Caf&eacute;&reg; &amp; Cr&egrave;me™"), "Café & Crème");
  assert.doesNotThrow(() => cleanDisplay("&#99999999;"));
  const base = (await catalog()).offers[0];
  const a = { ...base, id: "a", title: "Café™ Beans &amp; Nuts", category: "Other" };
  const b = { ...a, id: "b" };
  assert.deepEqual(matchDealOffers("café bean", [b, a], "exact", now).matches.map(m => m.ref), ["a", "b"]);
  assert.equal(matchDealOffers("bea", [a], "exact", now).matches.length, 0);
  assert.equal(matchDealOffers("chicken", [{ ...a, brand: "Chicken", department: "Chicken" }], "exact", now).matches.length, 0);
  assert.equal(matchDealOffers("café bean", [{ ...a, endsAt: "2026-11-12" }, { ...b, startsAt: "2026-11-14" }], "exact", now).matches.length, 0);
  const cleaned = matchDealOffers("café bean", [a], "exact", now).matches[0];
  assert.equal(cleaned.title, "Café Beans & Nuts");
  assert.equal(a.title, "Café™ Beans &amp; Nuts");
});

test("ranking uses title tiers, department fit, discounts and stable ties", async () => {
  const base = (await catalog()).offers[0];
  const make = (id: string, title: string, percentOff: number, category = "Meat & poultry") => ({
    ...base, id, title, category, department: category, sourceCategories: [category],
    promotion: { ...base.promotion, percentOff },
  });
  const offers = [
    make("tokens", "Chicken Boneless Thighs", 90),
    make("pets", "Chicken Thighs Dog Food", 99, "Pets"),
    make("low", "Chicken Thighs", 10),
    make("high", "Chicken Thighs", 50),
  ];
  assert.deepEqual(matchDealOffers("chicken thighs", offers, "exact", now).matches.map(m => m.ref), ["high", "low", "pets", "tokens"]);
  assert.deepEqual(matchDealOffers("chicken thighs", [...offers].reverse(), "exact", now).matches.map(m => m.ref), ["high", "low", "pets", "tokens"]);
});

test("response preserves promotion, membership, variant details and undated Costco context", async () => {
  const data = await catalog();
  const eggs = checkDeals("eggs", data, "exact", now);
  assert.equal(eggs.status, "ok");
  assert.equal(eggs.matches[0].promotion.text, data.offers[0].promotion.rawText);
  assert.match(eggs.matches[0].description, /12 ct/);
  const prime = eggs.matches.find(m => m.retailer === "wholefoods")!;
  assert.equal(prime.membership?.price, 3.5);
  assert.equal(prime.membership?.memberOnly, true);
  assert.equal(prime.pricing.salePrice, 4);
  const coffee = checkDeals("coffee", data, "exact", now).matches[0];
  assert.equal(coffee.validity.text, "Current listing");
  assert.equal(coffee.validity.endsAt, null);
  assert.equal(coffee.size, null);
  const coupon = matchDealOffers("eggs", [{ ...data.offers[0], size: "12 ct", promotion: { ...data.offers[0].promotion, couponRequired: true } }], "exact", now).matches[0];
  assert.equal(coupon.size, "12 ct");
  assert.ok(coupon.promotion.couponRequired && coupon.warnings.some(w => w.includes("coupon")));
  const none = checkDeals("chicken thighs", data, "exact", now);
  assert.equal(none.status, "no_matches");
  assert.equal(none.sources.length, 3);
});

test("snapshot timestamps include empty sources and the exact 26-hour boundary", async () => {
  const emptyReader: SnapshotReader = async pathname => pathname.includes("publix") ? { storeId: "719", retrievedAt: "2026-11-12T16:00:00Z", products: [] } : pathname.includes("wholefoods") ? { retrievedAt: "invalid", deals: [] } : { categories: [] };
  const data = await loadDealCheckCatalog("719", { reader: emptyReader, now, useBlob: false });
  assert.equal(data.sources[0].stale, false);
  assert.equal(data.sources[1].stale, true);
  assert.equal(data.sources[2].latestSourceUpdate, null);
  assert.ok(data.sources.every(s => s.state === "available"));
  const later = await loadDealCheckCatalog("719", { reader: emptyReader, now: new Date(now.getTime() + 1), useBlob: false });
  assert.equal(later.sources[0].stale, true);
  assert.equal(checkDeals("eggs", data, "exact", now).status, "degraded");
});

test("remote reads precede local fallback, malformed sources are isolated and store mismatches rejected", async () => {
  const calls: string[] = [];
  const data = await loadDealCheckCatalog("719", { now, useBlob: true, reader: async (pathname, origin) => {
    calls.push(`${pathname}:${origin}`);
    if (pathname.includes("publix") && origin === "blob") return { storeId: "999", products: [] };
    if (pathname.includes("costco")) return { categories: [{}] };
    return reader(pathname, origin);
  } });
  assert.equal(data.sources[0].state, "fallback");
  assert.equal(data.sources[1].state, "unavailable");
  assert.equal(data.sources[2].state, "available");
  assert.ok(calls.indexOf("data/publix/719/current.json:blob") < calls.indexOf("data/publix/719/current.json:local"));
  assert.ok(!calls.includes("data/wholefoods/current.json:local"));
  assert.equal(checkDeals("eggs", data, "exact", now).status, "degraded");
  const mismatch = await loadDealCheckCatalog("999", { reader, now, useBlob: false });
  assert.equal(mismatch.sources[0].state, "unavailable");
});

test("HTTP contract and paging use isolated fixtures without network or SQLite", async t => {
  const originalCwd = process.cwd();
  const temp = await mkdtemp(path.join(os.tmpdir(), "deal-check-test-"));
  const originalBlob = process.env.BLOB_READ_WRITE_TOKEN;
  const originalStore = process.env.PUBLIX_STORE_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.PUBLIX_STORE_ID = "719";
  t.mock.timers.enable({ apis: ["Date"], now });
  try {
    process.chdir(temp);
    for (const invalid of ["", "?item=", "?item=!!!", "?item=eggs&scope=bad"]) assert.equal((await matchGET(new Request(`http://test/api/deals/match${invalid}`))).status, 400);
    const unavailable = await matchGET(new Request("http://test/api/deals/match?item=eggs"));
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).status, "degraded");
    for (const [file, contents] of [["data/publix/719/current.json", fixture.publix], ["data/costco/current.json", fixture.costco], ["data/wholefoods/current.json", fixture.wholefoods]] as const) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(contents));
    }
    const matched = await matchGET(new Request("http://test/api/deals/match?item=eggs"));
    assert.equal(matched.status, 200);
    assert.equal((await matched.json()).status, "ok");
    const empty = await matchGET(new Request("http://test/api/deals/match?item=chicken%20thighs"));
    assert.equal((await empty.json()).status, "no_matches");
    await rm("data/costco/current.json");
    const partial = await matchGET(new Request("http://test/api/deals/match?item=eggs"));
    assert.equal(partial.status, 200);
    assert.equal((await partial.json()).status, "degraded");
    await writeFile("data/costco/current.json", JSON.stringify(fixture.costco));
    const many = structuredClone(fixture.publix);
    many.promotions.Savings = Array.from({ length: 60 }, (_, i) => ({ ...many.promotions.Savings[0], id: `coffee-${i}`, title: "Coffee" }));
    await writeFile("data/publix/719/current.json", JSON.stringify(many));
    for (const [suffix, limit] of [["", 50], ["&limit=7", 7], ["&limit=1000", 100], ["&limit=bad", 50]] as const) {
      const response = await dealsGET(new Request(`http://test/api/deals?q=coffee${suffix}`));
      const body = await response.json();
      assert.equal(body.limit, limit);
      assert.equal(body.deals.length, Math.min(limit, 61));
    }
    const all = await matchGET(new Request("http://test/api/deals/match?item=coffee"));
    assert.equal((await all.json()).matches.length, 61);
  } finally {
    process.chdir(originalCwd);
    if (originalBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = originalBlob;
    if (originalStore === undefined) delete process.env.PUBLIX_STORE_ID; else process.env.PUBLIX_STORE_ID = originalStore;
    t.mock.timers.reset();
    await rm(temp, { recursive: true, force: true });
  }
});
