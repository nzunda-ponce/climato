import { NextResponse, type NextRequest } from "next/server";
import { isReportServer, reportRequestAllowed } from "./runtime/role";
export function middleware(request: NextRequest) {
  if (
    isReportServer() &&
    !reportRequestAllowed(request.nextUrl.pathname, request.method)
  )
    return NextResponse.json(
      {
        error:
          "Este enlace es de consulta. Las actualizaciones se realizan en un proceso separado.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*"] };
