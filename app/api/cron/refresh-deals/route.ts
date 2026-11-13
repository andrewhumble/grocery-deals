import { execFile as execFileCallback } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { dealSnapshotPaths, writeDealSnapshot } from "@/lib/deal-snapshot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execFile = promisify(execFileCallback);

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

async function runRefresh(script: string, dataDirectory: string, storeId: string): Promise<void> {
  await execFile(process.execPath, [path.join(process.cwd(), script)], {
    cwd: process.cwd(),
    // Keep Hobby Cron runs bounded while still advancing a portion of Publix's
    // unusually large grouped-promotion list every day.
    env: {
      ...process.env,
      PANTRY_SIGNAL_DATA_DIRECTORY: dataDirectory,
      PUBLIX_STORE_ID: storeId,
      PUBLIX_ELIGIBLE_LIMIT: "20",
      PANTRY_PUBLIX_REQUEST_TIMEOUT_MS: "8000",
      PANTRY_PUBLIX_RETRY_BASE_MS: "500",
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 42_000,
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Deal storage is not configured." }, { status: 503 });
  }

  const storeId = process.env.PUBLIX_STORE_ID ?? "719";
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "pantry-signal-refresh-"));
  const publixDirectory = path.join(dataDirectory, "publix", storeId);
  const checkpointPath = path.join(publixDirectory, "eligible-products.checkpoint.json");

  try {
    await mkdir(publixDirectory, { recursive: true });
    const checkpointBlob = await get(`data/publix/${storeId}/eligible-products.checkpoint.json`, { access: "private", useCache: false });
    const checkpointContents = checkpointBlob?.statusCode === 200
      ? await new Response(checkpointBlob.stream).text()
      : await readFile(path.join(process.cwd(), "data", "publix", storeId, "eligible-products.checkpoint.json"), "utf8").catch(() => null);
    if (checkpointContents) await writeFile(checkpointPath, checkpointContents);

    const refreshes = [
      { retailer: "Publix", script: "scripts/fetch-publix.mjs", pathname: dealSnapshotPaths.publix(storeId), filename: path.join(publixDirectory, "current.json") },
      { retailer: "Costco", script: "costco/fetch-weekly-deals.mjs", pathname: dealSnapshotPaths.costco, filename: path.join(dataDirectory, "costco", "current.json") },
      { retailer: "Whole Foods", script: "wholefoods/fetch-weekly-deals.mjs", pathname: dealSnapshotPaths.wholeFoods, filename: path.join(dataDirectory, "wholefoods", "current.json") },
    ];
    const results = await Promise.all(refreshes.map(async (refresh) => {
      try {
        await runRefresh(refresh.script, dataDirectory, storeId);
        const contents = await readFile(refresh.filename, "utf8");
        await writeDealSnapshot(refresh.pathname, contents);
        const unresolvedPromotionCount = refresh.retailer === "Publix"
          ? Number((JSON.parse(contents) as { unresolvedPromotionCount?: number }).unresolvedPromotionCount ?? 0)
          : 0;
        return { retailer: refresh.retailer, refreshed: true, unresolvedPromotionCount };
      } catch (error) {
        console.error(`${refresh.retailer} deal refresh failed`, error);
        return { retailer: refresh.retailer, refreshed: false };
      }
    }));

    // Publix grouped promotions are checkpointed one request at a time. Keep
    // that progress between daily runs when the Hobby function time limit hits.
    const checkpointContentsAfterRefresh = await readFile(checkpointPath, "utf8").catch(() => null);
    if (checkpointContentsAfterRefresh) {
      await writeDealSnapshot(`data/publix/${storeId}/eligible-products.checkpoint.json`, checkpointContentsAfterRefresh);
    }

    return NextResponse.json({
      refreshedAt: new Date().toISOString(),
      storeId,
      sources: results,
      complete: results.every((result) => result.refreshed && result.unresolvedPromotionCount === 0),
    });
  } catch (error) {
    console.error("Daily deal refresh failed", error);
    return NextResponse.json({ error: "One or more deal sources failed to refresh." }, { status: 500 });
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}
