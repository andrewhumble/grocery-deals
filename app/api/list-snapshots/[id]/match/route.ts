import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { loadDeals } from "@/lib/deals";
import { createMatchRun } from "@/lib/lists";
import { loadStoreProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await params).id;
  const run = await createMatchRun(id, await loadDeals(await loadStoreProfile()));
  if (!run) return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
  return NextResponse.json({ matchRun: run }, { status: 201 });
}
