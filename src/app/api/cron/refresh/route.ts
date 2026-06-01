import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/fmp";
import { setSnapshot } from "@/lib/store";

// Vercel Cron hits this on a schedule (see vercel.json). It sends
// `Authorization: Bearer <CRON_SECRET>`, which we verify before doing work.
export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds; refreshing the universe takes a while

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const snapshot = await buildSnapshot();
    await setSnapshot(snapshot);
    return NextResponse.json({
      ok: true,
      companies: snapshot.companies.length,
      generatedAt: snapshot.generatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
