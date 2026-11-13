# Pantry Signal

A small local-first deals browser with Publix, Costco, and Whole Foods sources. It deliberately models retailer records as **offers**, not presumed products: an offer can cover a group of products, sizes, exclusions, channels, or a coupon condition.

## Run it

```sh
npm install
npm run dev
```

Open `http://localhost:3000`.

## Stores and scheduled refresh

Use **Sources & stores** in the app to save your Publix store number and optional Costco / Whole Foods location preferences. The profile is stored locally at `data/profile.json`; changing the Publix store takes effect the next time it is refreshed.

Refresh every source at once:

```sh
npm run refresh:all
```

On macOS, create a daily 7:00 AM refresh job with `npm run schedule:daily`. The command prints the one-time `launchctl` activation command. Set `PANTRY_REFRESH_HOUR` to choose a different hour.

The app initially reads `publix/response-example.json`. To refresh it from the selected Publix store, run:

```sh
PUBLIX_STORE_ID=719 npm run refresh:publix
```

That writes `data/publix/<store-id>/current.json`; the app automatically prefers that file over the fixture. The source response remains untouched, so it is safe as a parser fixture.

Costco warehouse savings are already available in `data/costco/current.json`. Refresh them with:

```sh
npm run refresh:costco
```

Costco’s source identifies warehouse, online-only, and warehouse-plus-online availability, but does not publish end dates for most deals. The dashboard therefore marks those as “Current listing” instead of inventing an expiry date.

Whole Foods all-deals data is available in `data/wholefoods/current.json`. Refresh it with:

```sh
npm run refresh:wholefoods
```

The Whole Foods source provides individual product prices and savings. When it publishes a Prime price, Pantry Signal preserves it as membership-only context and does not present it as the regular deal price.

## Data boundaries

- `scripts/fetch-publix.mjs`, `costco/fetch-weekly-deals.mjs`, and `wholefoods/fetch-weekly-deals.mjs` are the retailer-specific acquisition steps.
- `src/lib/normalize.ts`, `src/lib/costco.ts`, and `src/lib/wholefoods.ts` normalize raw records into a canonical `Offer` model while retaining source IDs and exact promotion text.
- `src/lib/match.ts` provides deterministic grocery-list candidate matching. It is intentionally conservative and exposes warnings rather than pretending ambiguous offers are exact replacements.
- `app/api/deals/route.ts` is a small canonical-offer API for a future mobile client, database, or AI workflow.

The current source is local JSON for KISS. The `Offer` type is the seam to preserve if the next step is adding Postgres, historical snapshots, additional retailers, or an AI reranker.

## Grocery-list agents

Pantry Signal now accepts durable, source-agnostic grocery-list snapshots and stores matching history in local SQLite. Hermes can act as the iPhone Notes adapter: it reads your selected note, submits a snapshot, requests matching, and presents the result without changing the note. See [the Hermes integration contract](docs/HERMES.md).

Hermes can also ask Pantry Signal directly for a curated weekly answer such as “What are the best meat deals this week?” The included MCP server exposes `best_meat_deals`, which ranks meal-building proteins—fresh cuts, sausage, and plain seafood—using retailer-published savings and price evidence. See [the Hermes integration contract](docs/HERMES.md).
