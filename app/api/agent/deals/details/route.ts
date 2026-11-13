import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { dealDetails } from "@/lib/retrieval/details";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { refs?: unknown };
    const refs = Array.isArray(body?.refs) ? body.refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0).slice(0, 10) : [];
    if (!refs.length) return NextResponse.json({ error: "refs must contain between 1 and 10 stable candidate references." }, { status: 400 });
    return NextResponse.json(await dealDetails(refs));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not retrieve deal details." }, { status: 400 });
  }
}
