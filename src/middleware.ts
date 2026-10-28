import { NextResponse, type NextRequest } from "next/server";

// Fast, optimistic gate: no session cookie -> send to /login.
// The real check (cookie verified against the database) happens in
// requireUser() on every page and server action.

// "/" is the public landing page (it sends signed-in users on to /dashboard).
const PUBLIC_PATHS = ["/", "/login", "/signup", "/privacy", "/terms"];

// Better Auth's session cookie (prefixed with __Secure- on HTTPS).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (!SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except auth API, Next internals and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|woff2?)$).*)"],
};
