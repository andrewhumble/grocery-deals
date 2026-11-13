import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { ensureDealIndex } from "@/lib/retrieval/index";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await ensureDealIndex());
}
