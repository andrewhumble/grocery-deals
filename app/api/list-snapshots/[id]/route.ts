import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { getListSnapshot, latestMatchRun } from "@/lib/lists";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const snapshot = getListSnapshot((await params).id);
  if (!snapshot) return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
  return NextResponse.json({ ...snapshot, latestMatchRun: latestMatchRun(snapshot.snapshot.id) });
}
