import { NextResponse } from "next/server";
import { autoSync } from "@/providers/auto-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(autoSync.status);
}
export async function POST() {
  // The local Node server owns the job; navigation or closing a tab does not cancel it.
  void autoSync.start();
  return NextResponse.json(autoSync.status, { status: 202 });
}
