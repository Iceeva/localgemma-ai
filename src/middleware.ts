import { NextResponse, type NextRequest } from "next/server";
import { checkRequestAllowed, REQUEST_HEADER } from "@/lib/security";

export function middleware(req: NextRequest) {
  const verdict = checkRequestAllowed({
    method: req.method,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    customHeader: req.headers.get(REQUEST_HEADER),
  });
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: verdict.reason,
          hint: "Ouvrez LocalGemma AI depuis http://localhost:3000 sur cet ordinateur.",
        },
      },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
