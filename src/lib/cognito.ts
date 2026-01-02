// src/lib/cognito.ts
import { cookies } from "next/headers";

const domain = process.env.COGNITO_DOMAIN!;
const clientId = process.env.COGNITO_CLIENT_ID!;
const clientSecret = process.env.COGNITO_CLIENT_SECRET!;
const redirectUri = process.env.COGNITO_REDIRECT_URI!;

function b64(str: string) {
  return Buffer.from(str).toString("base64");
}

export async function exchangeCodeForTokens(code: string) {
  const tokenUrl = `${domain}/oauth2/token`;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Cognito token exchange failed:", res.status, text);
    throw new Error(`Token exchange failed ${res.status}`);
  }

  return res.json() as Promise<{
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export async function refreshTokens(refreshToken: string) {
  const res = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${b64(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  return res.json() as Promise<{
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export function decodeJwt<T = any>(jwt: string): T {
  const [, payload] = jwt.split(".");
  const json = Buffer.from(
    payload.padEnd(payload.length + (4 - (payload.length % 4)) % 4, "="),
    "base64"
  ).toString("utf8");
  return JSON.parse(json);
}

export async function getUserInfo(accessToken: string) {
  const res = await fetch(`${domain}/oauth2/userInfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`userInfo failed: ${res.status}`);
  return res.json();
}

// cookie helpers
const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // avoids local dev pain
  sameSite: "lax" as const,
  path: "/",
};

export async function setAuthCookies(tokens: {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}) {
  const c = await cookies(); // ✅ await in Next 15  [oai_citation:1‡Next.js](https://nextjs.org/docs/app/api-reference/functions/cookies?utm_source=chatgpt.com)
  const exp = new Date(Date.now() + tokens.expires_in * 1000);

  c.set("e42_at", tokens.access_token, { ...cookieOpts, expires: exp });
  c.set("e42_it", tokens.id_token, { ...cookieOpts, expires: exp });

  if (tokens.refresh_token) {
    c.set("e42_rt", tokens.refresh_token, {
      ...cookieOpts,
      expires: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
  }
}

export async function clearAuthCookies() {
  const c = await cookies(); // ✅ await in Next 15  [oai_citation:2‡Next.js](https://nextjs.org/docs/app/api-reference/functions/cookies?utm_source=chatgpt.com)
  ["e42_at", "e42_it", "e42_rt"].forEach((name) => c.delete(name));
}