import { NextResponse } from "next/server";
import { autoSync } from "@/providers/auto-sync";
import { operationalSync } from "@/providers/operational-sync";
import { verificationSync } from "@/providers/verification-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function status() {
  const current = operationalSync.status.running
    ? operationalSync.status
    : autoSync.status.running
      ? autoSync.status
      : verificationSync.status;
  const errors = [
    ...new Set([
      ...autoSync.status.errors,
      ...operationalSync.status.errors,
      ...verificationSync.status.errors,
    ]),
  ];
  return {
    ...current,
    errors,
    message:
      !current.running && errors.length
        ? "Carga parcial. Se reintentará automáticamente."
        : current.message,
  };
}
export async function GET() {
  return NextResponse.json(status());
}
export async function POST() {
  // The local Node server owns the job; navigation or closing a tab does not cancel it.
  void autoSync.start();
  void operationalSync.start();
  void verificationSync.start();
  return NextResponse.json(status(), { status: 202 });
}
