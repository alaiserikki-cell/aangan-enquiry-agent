import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isDashboardPublic, isValidSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (isDashboardPublic()) return NextResponse.next();
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
