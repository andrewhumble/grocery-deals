import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { searchDealCandidates } from "@/lib/retrieval/search";
import type { DealSearchRequest } from "@/lib/retrieval/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as DealSearchRequest;
    if (!body || typeof body.query !== "string" || !body.query.trim()) return NextResponse.json({ error: "query is required." }, { status: 400 });
    return NextResponse.json(await searchDealCandidates(body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search deal candidates." }, { status: 400 });
  }
}
