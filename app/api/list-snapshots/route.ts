import { NextResponse } from "next/server";
import { agentRequestAuthorized } from "@/lib/agent-auth";
import { createListSnapshot, listSnapshots, validateListSnapshot } from "@/lib/lists";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ snapshots: listSnapshots() });
}

export async function POST(request: Request) {
  if (!agentRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = createListSnapshot(validateListSnapshot(await request.json()));
    return NextResponse.json(result, { status: result.existing ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create list snapshot." }, { status: 400 });
  }
}
