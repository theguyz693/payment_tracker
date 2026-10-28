import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./lib/csp";

// 1. Content Security Policy with a per-request nonce (Next.js applies the
//    nonce to its own scripts; the root layout applies it to the theme script).
// 2. Fast, optimistic gate: no session cookie -> send to /login.
//    The real check (cookie verified against the database) happens in
//    requireUser() on every page and server action.

// "/" is the public landing page (it sends signed-in users on to /dashboard).
const PUBLIC_PATHS = ["/", "/login", "/signup", "/privacy", "/terms"];

// Better Auth's session cookie (prefixed with __Secure- on HTTPS).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PUBLIC_PATHS.includes(pathname) && !SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except auth API, Next internals and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|textures/|.*\\.(?:png|svg|ico|webp|woff2?)$).*)"],
};
