import { NextResponse } from "next/server";
import { loadStoreProfile, saveStoreProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ profile: await loadStoreProfile() });
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json({ profile: await saveStoreProfile(await request.json()) });
  } catch {
    return NextResponse.json({ error: "Invalid profile request." }, { status: 400 });
  }
}
