import { NextResponse } from "next/server";
import { getCloudApiUrl } from "./cloud-mode";

export function getAuthCookies(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
  return {
    token: cookies["aicib_cloud_token"] || "",
    businessId: cookies["aicib_business_id"] || "",
  };
}

function forwardHeaders(request: Request, token: string): HeadersInit {
  const headers: Record<string, string> = {
    Cookie: `aicib_session=${token}`,
  };
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return headers;
}

async function forwardBody(request: Request): Promise<BodyInit | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  try {
    return await request.text();
  } catch {
    return undefined;
  }
}

function forwardQuery(request: Request): string {
  const url = new URL(request.url);
  return url.search;
}

function clearAuthCookiesResponse(): NextResponse {
  const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  res.cookies.set("aicib_cloud_token", "", { maxAge: 0, path: "/" });
  res.cookies.set("aicib_business_id", "", { maxAge: 0, path: "/" });
  return res;
}

/**
 * Proxy to a business-scoped cloud route.
 * URL: ${CLOUD_API_URL}/businesses/${businessId}/${path}
 */
export async function cloudFetch(
  request: Request,
  path: string,
  options?: { method?: string }
): Promise<NextResponse> {
  const { token, businessId } = getAuthCookies(request);
  if (!token) return clearAuthCookiesResponse();
  if (!businessId) {
    return NextResponse.json(
      { error: "No business selected" },
      { status: 400 }
    );
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) {
    return NextResponse.json({ error: "Invalid business" }, { status: 400 });
  }

  const baseUrl = getCloudApiUrl();
  const query = forwardQuery(request);
  const url = `${baseUrl}/businesses/${businessId}/${path}${query}`;
  const method = options?.method || request.method;

  const upstream = await fetch(url, {
    method,
    headers: forwardHeaders(request, token),
    body: await forwardBody(request),
  });

  if (upstream.status === 401) return clearAuthCookiesResponse();

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
  });
}

/**
 * Proxy to an org-scoped cloud route (no businessId prefix).
 * URL: ${CLOUD_API_URL}/${path}
 */
export async function cloudFetchOrg(
  request: Request,
  path: string,
  options?: { method?: string; body?: string }
): Promise<NextResponse> {
  const { token } = getAuthCookies(request);
  if (!token) return clearAuthCookiesResponse();

  const baseUrl = getCloudApiUrl();
  const query = forwardQuery(request);
  const url = `${baseUrl}/${path}${query}`;
  const method = options?.method || request.method;

  const upstream = await fetch(url, {
    method,
    headers: forwardHeaders(request, token),
    body: options?.body ?? await forwardBody(request),
  });

  if (upstream.status === 401) return clearAuthCookiesResponse();

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
  });
}

/**
 * Proxy for auth routes (login/signup/accept-invite).
 * Captures aicib_session cookie from Hono and re-sets as aicib_cloud_token.
 */
export async function cloudFetchAuth(
  request: Request,
  path: string,
  body: unknown
): Promise<NextResponse> {
  const baseUrl = getCloudApiUrl();
  const url = `${baseUrl}/${path}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await upstream.text();
  const res = new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });

  // Capture aicib_session cookie from Hono response and re-set as aicib_cloud_token
  if (upstream.ok) {
    const setCookieHeader = upstream.headers.get("set-cookie");
    if (setCookieHeader) {
      const match = setCookieHeader.match(/aicib_session=([^;]+)/);
      if (match) {
        res.cookies.set("aicib_cloud_token", match[1], {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });
      }
    }
  }

  return res;
}
