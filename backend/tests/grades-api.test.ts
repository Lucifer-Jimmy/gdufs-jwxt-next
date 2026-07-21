import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSecurityConfig } from "../src/config/security-config";
import { LOGIN_COOKIE_NAME, sealLoginState } from "../src/session/auth-state";
import {
  gradeDetailResponseSchema,
  gradesRefreshResponseSchema,
  gradesResponseSchema,
} from "../src/schemas/api";
import type { UpstreamFetch } from "../src/upstream/client";

const grade = {
  kch: "GW20021",
  kc_mc: "高等数学",
  xnxqid: "2025-2026-1",
  xf: 4,
  zcjstr: "92",
  zcj: 92,
  jd: 4.2,
  ksfs: "考试",
  kcsx: "必修",
  txklb: "自然科学",
  xs0101id: "student-fixture",
  jx0404id: "class-fixture",
  cj0708id: "record-fixture",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("grades API", () => {
  it("returns grades, validates the response, and renews the login Cookie", async () => {
    const accountHash = uniqueHash("get");
    const browserCookies = await loginCookies(accountHash);
    const originalToken = browserCookies.get(LOGIN_COOKIE_NAME);
    const requests: Request[] = [];
    vi.stubGlobal("fetch", gradeFetcher(requests));

    const response = await apiGet("/api/v1/grades", browserCookies);

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    applyResponseCookies(response, browserCookies);
    expect(browserCookies.get(LOGIN_COOKIE_NAME)).not.toBe(originalToken);
    expect(gradesResponseSchema.parse(await response.json())).toEqual({
      reachedPageLimit: false,
      grades: [
        expect.objectContaining({
          courseName: "高等数学",
          credits: 4,
          score: "92",
        }),
      ],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("Cookie")).toBe(
      "JSESSIONID=fixture-session",
    );
  });

  it("limits manual refresh per account and returns the server retry delay", async () => {
    const browserCookies = await loginCookies(uniqueHash("refresh"));
    vi.stubGlobal("fetch", gradeFetcher([]));

    const first = await apiPost("/api/v1/grades/refresh", {}, browserCookies);
    expect(first.status).toBe(200);
    expect(first.headers.get("Retry-After")).toBeNull();
    expect(gradesRefreshResponseSchema.parse(await first.json())).toEqual(
      expect.objectContaining({ retryAfterSeconds: 30 }),
    );

    const second = await apiPost("/api/v1/grades/refresh", {}, browserCookies);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("30");
    const error: {
      error: { code: string; retryAfterSeconds?: number };
    } = await second.json();
    expect(error.error).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });
    expect(JSON.stringify(error)).not.toContain("JSESSIONID");
  });

  it("consumes refresh capacity before an upstream failure", async () => {
    const browserCookies = await loginCookies(uniqueHash("failure"));
    let calls = 0;
    vi.stubGlobal("fetch", (() => {
      calls += 1;
      return Promise.resolve(new Response("upstream failure", { status: 503 }));
    }) satisfies UpstreamFetch);

    const first = await apiPost("/api/v1/grades/refresh", {}, browserCookies);
    expect(first.status).toBe(502);
    expect(first.headers.getSetCookie()).toHaveLength(0);

    const second = await apiPost("/api/v1/grades/refresh", {}, browserCookies);
    expect(second.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("fetches grade detail with the four identifiers from the request", async () => {
    const browserCookies = await loginCookies(uniqueHash("detail"));
    const requests: Request[] = [];
    vi.stubGlobal("fetch", detailFetcher(requests));

    const response = await apiPost(
      "/api/v1/grades/detail",
      {
        studentKey: "student / fixture",
        teachingClassKey: "class&fixture",
        gradeRecordKey: "record?fixture",
        totalScore: "84",
      },
      browserCookies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(gradeDetailResponseSchema.parse(await response.json())).toEqual({
      cjxm1: 66,
      zcj: "84",
      cjxm3: 96,
      cjxm2: 0,
      cjxm3bl: "60%",
      cjxm2bl: "0%",
      cjxm1bl: "40%",
    });

    const url = new URL(requests[0]?.url ?? "https://invalid.test");
    expect(url.pathname).toBe("/jsxsd/kscj/pscj_list.do");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      xs0101id: "student / fixture",
      jx0404id: "class&fixture",
      cj0708id: "record?fixture",
      zcj: "84",
    });
  });

  it("rejects non-JSON and cross-origin POST requests before authentication", async () => {
    const browserCookies = await loginCookies(uniqueHash("guards"));
    vi.stubGlobal("fetch", gradeFetcher([]));

    const contentType = await SELF.fetch(
      "https://example.test/api/v1/grades/refresh",
      {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          Cookie: cookieHeader(browserCookies),
        },
        body: "{}",
      },
    );
    expect(contentType.status).toBe(400);
    await expect(contentType.json()).resolves.toMatchObject({
      error: { code: "INVALID_CONTENT_TYPE" },
    });

    const origin = await apiPost(
      "/api/v1/grades/refresh",
      {},
      browserCookies,
      "https://attacker.example",
    );
    expect(origin.status).toBe(403);
    await expect(origin.json()).resolves.toMatchObject({
      error: { code: "INVALID_ORIGIN" },
    });
  });

  it("clears the login Cookie on an upstream login page and does not renew on failure", async () => {
    const browserCookies = await loginCookies(uniqueHash("expired"));
    const originalToken = browserCookies.get(LOGIN_COOKIE_NAME);
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response("<html><title>登录</title><form id=loginForm></form>"),
      )) satisfies UpstreamFetch);

    const response = await apiGet("/api/v1/grades", browserCookies);

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toContain(
      `${LOGIN_COOKIE_NAME}=; Max-Age=0; Path=/api; Secure; HttpOnly; SameSite=Strict`,
    );
    expect(response.headers.getSetCookie()).not.toContain(
      expect.stringContaining(`${LOGIN_COOKIE_NAME}=v1.`),
    );
    expect(await response.text()).not.toContain(originalToken ?? "");
  });
});

async function loginCookies(accountHash: string): Promise<Map<string, string>> {
  const config = loadSecurityConfig(env);
  const token = await sealLoginState(
    {
      accountHash,
      upstreamCookies: [
        {
          name: "JSESSIONID",
          value: "fixture-session",
          domain: "jwxt.gdufs.edu.cn",
          path: "/",
          hostOnly: true,
          secure: true,
        },
      ],
    },
    config.sessionKey,
    Math.floor(Date.now() / 1_000),
  );
  return new Map([[LOGIN_COOKIE_NAME, token]]);
}

function gradeFetcher(requests: Request[]): UpstreamFetch {
  return (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return Promise.resolve(
      new Response(JSON.stringify({ code: 0, data: [grade] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
}

function detailFetcher(requests: Request[]): UpstreamFetch {
  return (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return Promise.resolve(
      new Response(
        '<script>let arr = [{"cjxm1":66,"zcj":"84","cjxm3":96,"cjxm2":0,"cjxm3bl":"60%","cjxm2bl":"0%","cjxm1bl":"40%"}];</script>',
      ),
    );
  };
}

async function apiGet(
  path: string,
  cookies: ReadonlyMap<string, string>,
): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    headers: { Cookie: cookieHeader(cookies) },
  });
}

async function apiPost(
  path: string,
  body: unknown,
  cookies: ReadonlyMap<string, string>,
  origin = "https://example.test",
): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "203.0.113.10",
      Cookie: cookieHeader(cookies),
    },
    body: JSON.stringify(body),
  });
}

function cookieHeader(cookies: ReadonlyMap<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function applyResponseCookies(
  response: Response,
  cookies: Map<string, string>,
): void {
  for (const serialized of response.headers.getSetCookie()) {
    const pair = serialized.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (pair === undefined || separator < 1) {
      continue;
    }
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (/Max-Age=0(?:;|$)/iu.test(serialized)) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
}

function uniqueHash(label: string): string {
  return `${label}${"x".repeat(43 - label.length)}`;
}
