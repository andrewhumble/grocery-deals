import "server-only";

import { get, put } from "@vercel/blob";
import { readFile } from "node:fs/promises";

export const dealSnapshotPaths = {
  costco: "data/costco/current.json",
  wholeFoods: "data/wholefoods/current.json",
  publix: (storeId: string) => `data/publix/${storeId}/current.json`,
};

export async function readDealSnapshot<T>(pathname: string, localPath: string): Promise<T> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await get(pathname, { access: "private", useCache: false });
      if (blob?.statusCode === 200) return await new Response(blob.stream).json() as T;
    } catch {
      // Keep the bundled snapshot available if Blob is temporarily unavailable.
    }
  }

  return JSON.parse(await readFile(localPath, "utf8")) as T;
}

export async function writeDealSnapshot(pathname: string, contents: string): Promise<void> {
  await put(pathname, contents, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
