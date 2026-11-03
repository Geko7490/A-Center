import { NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();

  const token = process.env.VEX_LOCAL_TOKEN;
  if (!token) return NextResponse.next();

  const supplied = request.headers.get("x-vex-local-token") || "";
  if (supplied.length !== token.length || supplied !== token) {
    return NextResponse.json({ error: "unauthorized local application request" }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      const requestHost = request.headers.get("host") || request.nextUrl.host;
      const requestUrl = new URL(`http://${requestHost}`);
      const port = (url: URL) => url.port || (url.protocol === "https:" ? "443" : "80");
      if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) || !LOOPBACK_HOSTS.has(requestUrl.hostname.toLowerCase()) || port(parsed) !== port(requestUrl)) {
        return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };

