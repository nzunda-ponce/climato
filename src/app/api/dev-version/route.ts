import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  const version =
    process.env.NODE_ENV === "development"
      ? process.env.CLIMATO_DEV_REVISION
      : undefined;
  return NextResponse.json(
    { version: version ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
