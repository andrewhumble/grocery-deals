# Hermes grocery-list integration

Pantry Signal accepts a grocery-list snapshot from Hermes, performs a match run against the current deal catalog, and returns a durable, structured result. It does not read or write iPhone Notes itself.

## Local MCP deal catalog

For conversational deal questions, run Pantry Signal locally with `npm run agent:serve`, then add the included read-only MCP server to Hermes:

```bash
hermes mcp add pantry-signal --command node --args /Users/andrewhumble/projects/grocery-deals/scripts/pantry-signal-mcp.mjs
```

The server exposes three read-only tools:

- `search_deal_candidates` is the primary grocery-search tool. It combines exact phrase, prefix lexical, SQLite full-text, and grocery-concept retrieval, then applies factual retailer, active-date, promotion, coupon, and price filters.
- `get_deal_details` batch-verifies selected stable references and returns exact terms, price basis, validity, source freshness, and proof URLs.
- `get_catalog_status` reports the active index version, document count, and source freshness.

Hermes makes the final shopper-facing relevance judgment, but Pantry Signal is responsible for high-recall candidate retrieval. For example, a search for `bread` can retrieve modeled descendant concepts such as buns, rolls, and bagels, while an exact `hot dog buns` search does not broaden into hot dogs. Search results include retrieval evidence and `retrievalComplete`; Hermes must not claim a product is absent unless the latter is true. It should retrieve details before naming a deal in a response. Reload Hermes MCP tools after adding or updating the server. If `HERMES_SHARED_SECRET` protects Pantry Signal, set the same environment variable for the MCP process.

## Contract

1. Hermes reads one user-selected grocery note and keeps its stable note identifier.
2. Hermes sends the note text to `POST /api/list-snapshots`.
3. Hermes calls `POST /api/list-snapshots/<snapshot-id>/match`.
4. Hermes presents the returned matches to the user. It must not alter the note unless the user explicitly asks it to.

The source is generic by design. Use `hermes_ios_notes` for `source`, the stable Notes identifier for `sourceRef`, and the visible note title for `sourceTitle`.

```json
{
  "source": "hermes_ios_notes",
  "sourceRef": "stable-ios-note-id",
  "sourceTitle": "Groceries",
  "capturedAt": "2026-09-01T16:00:00Z",
  "rawText": "Eggs\nCoffee beans | medium roast\nChicken thighs | boneless okay"
}
```

An identical source, reference, and note body returns the existing snapshot rather than creating a duplicate. Every distinct note body is preserved as a new snapshot.

## Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/list-snapshots` | Create or retrieve a snapshot |
| `GET` | `/api/list-snapshots` | List snapshot metadata |
| `POST` | `/api/list-snapshots/:id/match` | Run matching against current deals |
| `GET` | `/api/list-snapshots/:id` | Retrieve source text, lines, and latest run |
| `GET` | `/api/deals/catalog` | Catalog overview for agent planning |
| `GET` | `/api/deals` | Paginated structured deals; accepts factual filters and `cursor` |
| `GET` | `/api/deals?id=:deal-id` | Complete deal details by ID |
| `POST` | `/api/agent/deals/search` | High-recall, constraint-filtered candidate retrieval |
| `POST` | `/api/agent/deals/details` | Batch verification by stable candidate reference |
| `GET` | `/api/agent/deals/status` | Retrieval-index and source-freshness status |

Set `HERMES_SHARED_SECRET` on the Pantry Signal server to require `Authorization: Bearer <secret>` for every list endpoint. Without it, the endpoints are intended only for a local trusted network.

List snapshots and match history are stored locally in `data/pantry-signal.sqlite`. The supplied grocery text is never sent to a model by this layer.

## Public item deal checks

`GET /api/deals/match?item=chicken%20thighs` checks active offers without authentication or a SQLite index. `scope` defaults to `exact`; `substitutes` adds configured alternatives and `related` also adds related concepts and qualifier-only mentions. Missing/blank items and unsupported scopes return HTTP 400. Results are not truncated.

```sh
curl 'https://grocery-deals-one.vercel.app/api/deals/match?item=eggs'
curl 'https://grocery-deals-one.vercel.app/api/deals/match?item=hot%20dog%20buns&scope=related'
```

Responses contain `query`, `interpretation` (concept IDs and scope), `status`, `sources`, `matches`, and `warnings`. Match `ref` is the canonical offer ID (usable with `/api/deals?id=...`), not an agent-index reference. Match evidence includes `tier`, `kind`, `matchedTerms`, and `ambiguous`; always retain warnings when presenting a result. Generic buns may qualify for hot dog buns with a variety warning. Generic chicken does not qualify for chicken thighs. An unknown concept still supports whole-token title matching. Category or brand alone cannot produce a match.

Handle outcomes explicitly:

- HTTP 200, `ok`: at least one candidate, with all sources available and fresh. This is not a guarantee that a particular variety or size qualifies; inspect each match's warnings.
- HTTP 200, `no_matches`: no clear match in the available, fresh snapshots. Do not claim no deal exists anywhere.
- HTTP 200, `degraded`: stale, missing, invalid, or fallback source data; fresh-source candidates are retained; stale-source offers are omitted. Explain the coverage limitation even when matches are empty.
- HTTP 503, `degraded`: no usable source snapshot; say the check could not be completed. Other HTTP failures are errors, not empty searches.

Each source includes its actual store/source scope, `latestSourceUpdate`, `stale`, `state` (`available`, `fallback`, or `unavailable`), and warnings. Freshness uses acquisition timestamps (or the source update timestamp for legacy Publix snapshots); more than 26 hours or an unknown timestamp is stale. An empty but valid, freshly timestamped source is healthy. Blob failures may use same-source bundled data with an explicit fallback warning. The match endpoint never uses the Publix example fixture. Costco warehouse-savings and Whole Foods all-deals sources do not imply location-specific pricing.

Display text is cleaned, while `promotion.text` preserves the canonical promotion text. Pricing includes both price `basis` and `discountBasis`; promotion quantities, minimum spend, coupons, description, fine print, size/variant wording, and availability remain available. Dedicated `size` is null unless explicitly known. Prime prices appear only in `membership` with `memberOnly: true`, never in the ordinary sale price. An undated Costco offer has `validity.noPublishedEndDate: true` and `validity.text: "Current listing"`; that does not imply its source is fresh.

Clients may use these results in their own Google Tasks workflow; Pantry Signal never writes to Google Tasks. `/api/deals` remains the dashboard endpoint and defaults to 50 results when `limit` is omitted. This endpoint does not claim `retrievalComplete` or depend on the optional agent-index repair.

Known separate follow-up: profile routes currently lack authentication, and list/agent shared-secret checks fail open if no secret is configured. The public match endpoint does not change those existing behaviors.
