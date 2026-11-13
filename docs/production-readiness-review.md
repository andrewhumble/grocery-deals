# Production readiness review

Reviewed October 27, 2026.

The project has a solid foundation for a local, single-household application, but several issues should be addressed before exposing it publicly or deploying multiple instances.

The strongest architectural choice is the canonical `Offer` model, with retailer-specific acquisition and normalization kept separate. Preserving promotion conditions and source evidence is also valuable.

## Highest-priority production issues

### 1. Authentication fails open, and profile updates are unprotected

[`agent-auth.ts`](../src/lib/agent-auth.ts) authorizes every request when `HERMES_SHARED_SECRET` is missing. Separately, [the profile API](../app/api/profile/route.ts) lets any caller change the shared store profile—even when that secret is configured. Public exposure could allow access to grocery notes and unwanted configuration changes.

Require authentication in production, protect mutations, and add request-size and rate limits.

### 2. All users share one profile and one pool of grocery lists

The profile lives in one [JSON file](../src/lib/profile.ts), and [list storage](../src/lib/lists.ts) has no user or household ownership. A shared secret authenticates a client but provides no data isolation.

For a multiuser product, introduce household ownership and enforce it on every read and write.

### 3. Persistence assumes one machine with writable local storage

Source JSON, profile JSON, and two SQLite databases live beneath the application directory by default. Ephemeral deployments risk losing state; independent replicas would disagree. Concurrent profile saves also use the same `.tmp` filename.

For a small private deployment, SQLite can remain—with one instance, a persistent volume, serialized writes, and tested backups. For multiple instances, move durable state to a shared database and source snapshots to object storage.

### 4. Dependencies need a security update before launch

[`package.json`](../package.json) pins Next.js `16.1.6`. The official October 14, 2026 security release identifies `16.4.1` as a patched release addressing critical upstream issues. Upgrade to a current patched release and audit the lockfile; exploitability of individual advisories depends on enabled features and runtime.

Reference: [Official Next.js security advisory](https://nextjs.org/blog/nextjs-security-update-october-14-2026).

## Data correctness and reliability

### 5. Stale or fallback data can look like current deals

[`deals.ts`](../src/lib/deals.ts) falls back to the Publix example fixture when the selected store has no snapshot, then normalizes it using the selected store ID. Offers without expiration dates remain active indefinitely. Meanwhile, source status uses filesystem modification time.

Disable fixture fallback in production and track explicit acquisition timestamps, store provenance, and freshness thresholds. Distinguish “promotion has no end date” from “source is fresh.”

### 6. Publix checkpoints can reuse outdated product information

[`fetch-publix.mjs`](../scripts/fetch-publix.mjs) reuses eligible-product results by promotion ID without a freshness check or promotion-content fingerprint. If an ID persists while eligibility or pricing changes, old product data can enter a newly timestamped snapshot.

Scope checkpoints to a refresh generation or validate them against promotion content and age.

### 7. Acquisition needs stronger operational boundaries

Refresh scheduling is macOS LaunchAgent-specific. Publix requests lack explicit deadlines, jobs lack an overlap lock, and malformed source JSON can fail the entire combined catalog through `Promise.all`.

Use a scheduled worker with bounded retries/deadlines, validated snapshots, last-known-good data, and per-source failure reporting. Costco and Whole Foods location preferences currently do not parameterize their fetchers, so they should not imply verified local pricing.

## Performance and maintainability

### 8. Search still repeatedly scans the full catalog

[`searchDealCandidates`](../src/lib/retrieval/search.ts) loads and scores all indexed documents despite having FTS. Its status check also deserializes the catalog. [List matching](../src/lib/lists.ts) repeats this for each item, while ordinary deal requests reread and normalize roughly 14 MB of source JSON. The homepage sends every normalized offer to the browser.

Cache immutable catalog generations, batch list matching, paginate browser data, and use indexed candidate selection before scoring.

### 9. Index maintenance runs inside requests

[`ensureDealIndex`](../src/lib/retrieval/index.ts) can rebuild the index during search or status requests using synchronous SQLite operations. That creates latency spikes and blocks other work in the process.

Build and publish index generations in the refresh worker. Include taxonomy/normalizer versions in invalidation; currently source-file changes drive it.

### 10. Deployment checks and tests are incomplete

The repository contains only three tests, tied to mutable local data and current-date filtering. No repository CI configuration, migration workflow, readiness endpoint, or backup/restore procedure was found. Refresh/index commands also require `tsx`, which is a development dependency and would be missing from a production-only dependency installation.

Add isolated test fixtures, temporary databases, and a controlled clock. Establish CI, migrations, readiness checks, and a tested backup/restore procedure. Ensure the refresh worker includes its required runtime dependencies.

## Validation performed

- TypeScript checking (`npm run lint`): passed. This command runs `tsc --noEmit`, not a separate lint engine.
- Production build (`npm run build`): passed.
- Tests (`npm test`): one passed and two failed, both involving expected hot-dog-bun matches.
- Application source was not changed and retailer data was not refreshed during the review. Running tests can update the local retrieval index.

The build result does not establish production runtime, security, or load readiness.

## Recommended deployment path

Start with one authenticated Node instance with persistent storage and a separate scheduled refresh worker. Preserve the current module boundaries, fix authentication and freshness first, then add shared storage and household isolation when moving to a multiuser service.
