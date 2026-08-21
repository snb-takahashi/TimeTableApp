import { NextResponse } from "next/server";
import { getDefaultOrganization } from "@/lib/org";
import { requestCancellation } from "@/lib/generationProgress";

// A plain Route Handler for the same reason as /api/generation-progress:
// Server Actions invoked from the same page are queued and dispatched one
// at a time by React's client runtime, so a cancel request issued as an
// action would never reach the server while runAutoGenerate is in flight.
export async function POST() {
  const org = await getDefaultOrganization();
  requestCancellation(org.id);
  return NextResponse.json({ ok: true });
}
