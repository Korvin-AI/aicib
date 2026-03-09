import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  // Skip in local mode
  if (process.env.NEXT_PUBLIC_CLOUD_MODE !== "true") return NextResponse.next();

  const token = request.cookies.get("aicib_cloud_token");
  const isPublicPath = /^\/(login|signup|invite)/.test(request.nextUrl.pathname);

  if (!token && !isPublicPath) {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (token && isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon).*)"],
};
