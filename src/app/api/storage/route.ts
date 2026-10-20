import { isReportServer } from "@/runtime/role";
import { NextResponse } from "next/server";
import { getDatabase } from "@/persistence/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = await getDatabase();
    const info = await db.read(async (tx) => ({
      stats: await tx.stats(),
      migrated: !!(await tx.get("system", "migration-v2-complete")),
    }));
    const hostname =
      db.kind === "postgresql"
        ? new URL(process.env.DATABASE_URL!).hostname
        : "";
    const cloud =
      db.kind === "postgresql" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    return NextResponse.json(
      {
        readOnly: isReportServer(),
        cloud,
        backend: db.kind,
        migrated: info.migrated,
        equipment:
          info.stats.find((r) => r.namespace === "pivot")?.records ?? 0,
        storedBytes: info.stats.reduce((s, r) => s + r.bytes, 0),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo verificar la base de datos." },
      { status: 503 },
    );
  }
}
