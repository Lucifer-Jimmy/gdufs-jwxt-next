import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSecurityConfig } from "../src/config/security-config";
import { deriveRateLimitSubject } from "../src/rate-limit/subject";
import {
  MFA_COOKIE_NAME,
  openLoginState,
  sealMfaState,
} from "../src/session/auth-state";
import type { UpstreamFetch } from "../src/upstream/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authentication API", () => {
  it("preserves the complete production login sequence", async () => {
    const requests: Request[] = [];
    const fetcher: UpstreamFetch = (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Promise.resolve(upstreamResponse(request));
    };
    vi.stubGlobal("fetch", fetcher);

    const browserCookies = new Map<string, string>();
    const login = await apiPost(
      "/api/v1/auth/login",
      { username: "api-flow-account", password: "fixture-password" },
      browserCookies,
    );
    expect(login.status).toBe(200);
    applyResponseCookies(login, browserCookies);
    expect(browserCookies.has(MFA_COOKIE_NAME)).toBe(true);

    const mfaStatus = await apiGet("/api/v1/auth/mfa", browserCookies);
    expect(mfaStatus.status).toBe(200);
    await expect(mfaStatus.json()).resolves.toMatchObject({
      maskedPhone: "138****0000",
      codeSent: false,
      retryAfterSeconds: 0,
    });

    const sent = await apiPost("/api/v1/auth/mfa/send", {}, browserCookies);
    expect(sent.status).toBe(200);
    applyResponseCookies(sent, browserCookies);
    await expect(sent.json()).resolves.toEqual({
      message: "验证码已发送",
      retryAfterSeconds: 60,
    });

    const verified = await apiPost(
      "/api/v1/auth/mfa/verify",
      { code: "123456" },
      browserCookies,
    );
    expect(verified.status).toBe(200);
    applyResponseCookies(verified, browserCookies);
    expect(browserCookies.has(MFA_COOKIE_NAME)).toBe(false);
    expect(browserCookies.has("__Secure-jwxt_session")).toBe(true);
    const issuedLoginToken = browserCookies.get("__Secure-jwxt_session");

    const me = await apiGet("/api/v1/me", browserCookies);
    expect(me.status).toBe(200);
    expect(me.headers.getSetCookie()).toHaveLength(1);
    expect(me.headers.getSetCookie()[0]).toContain("__Secure-jwxt_session=");
    applyResponseCookies(me, browserCookies);
    expect(browserCookies.get("__Secure-jwxt_session")).not.toBe(
      issuedLoginToken,
    );
    await expect(me.json()).resolves.toEqual({
      studentId: "20210001",
      name: "脱敏姓名",
      college: "信息科学与技术学院",
      major: "软件工程",
    });

    expect(
      requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "GET https://authserver.gdufs.edu.cn/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
      "POST https://authserver.gdufs.edu.cn/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
      "GET https://authserver.gdufs.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
      "POST https://authserver.gdufs.edu.cn/authserver/dynamicCode/getDynamicCodeByReauth.do",
      "POST https://authserver.gdufs.edu.cn/authserver/reAuthCheck/reAuthSubmit.do",
      "GET https://authserver.gdufs.edu.cn/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
      "GET https://jwxt.gdufs.edu.cn/sso.jsp?ticket=ST-1-fixture",
      "GET https://jwxt.gdufs.edu.cn/sso.jsp",
      "GET https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=ST-2-fixture",
      "GET https://jwxt.gdufs.edu.cn/jsxsd/framework/xsMainV_new.htmlx?t1=1",
      "GET https://jwxt.gdufs.edu.cn/jsxsd/framework/xsMainV_new.htmlx?t1=1",
    ]);
    expect(requests[1]?.headers.get("Cookie")).toBe("AUTH=login");
    expect(requests[3]?.headers.get("Cookie")).toBe("AUTH=login; route=mfa");
    expect(requests[4]?.headers.get("Cookie")).toBe("AUTH=sent; route=mfa");
    expect(requests[6]?.headers.get("Cookie")).toBeNull();
    expect(requests[7]?.headers.get("Cookie")).toBe("SSO=first");
    expect(requests[8]?.headers.get("Cookie")).toBe("SSO=first");
    expect(requests[9]?.headers.get("Cookie")).toBe(
      "SSO=first; JSESSIONID=logged-in",
    );

    const loginToken = browserCookies.get("__Secure-jwxt_session");
    expect(loginToken).toBeDefined();
    const opened = await openLoginState(
      loginToken ?? "",
      loadSecurityConfig(env).sessionKey,
      Math.floor(Date.now() / 1_000),
    );
    expect(opened.status).toBe("valid");
    if (opened.status === "valid") {
      expect(opened.claims.payload).not.toHaveProperty("username");
      expect(opened.claims.payload.upstreamCookies).toHaveLength(2);
      expect(
        opened.claims.payload.upstreamCookies.every(
          (cookie) => cookie.domain === "jwxt.gdufs.edu.cn",
        ),
      ).toBe(true);
    }
  });

  it("clears MFA state on the fifth accepted verification failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: "reAuth_failed" }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const config = loadSecurityConfig(env);
    const now = Math.floor(Date.now() / 1_000);
    const accountHash = await deriveRateLimitSubject(
      "account",
      "failure-account",
      config.rateLimitHmacKey,
    );
    const token = await sealMfaState(
      {
        username: "failure-account",
        accountHash: accountHash.hash,
        flowId: "d6a7cbf1-a27a-4f5f-bd0f-a41e447b51b7",
        maskedPhone: "138****0000",
        codeSent: true,
        resendAllowedAt: now + 60,
        upstreamCookies: [],
      },
      config.sessionKey,
      now,
    );
    const browserCookies = new Map([[MFA_COOKIE_NAME, token]]);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await apiPost(
        "/api/v1/auth/mfa/verify",
        { code: "000000" },
        browserCookies,
      );
      expect(response.status).toBe(401);
      if (attempt < 5) {
        expect(response.headers.getSetCookie()).toHaveLength(0);
      } else {
        expect(response.headers.getSetCookie()).toContain(
          `${MFA_COOKIE_NAME}=; Max-Age=0; Path=/api; Secure; HttpOnly; SameSite=Strict`,
        );
      }
    }
  });
});

function upstreamResponse(request: Request): Response {
  const url = new URL(request.url);
  if (
    request.method === "GET" &&
    url.hostname === "authserver.gdufs.edu.cn" &&
    url.pathname === "/authserver/login"
  ) {
    const ticketRequest = request.headers.get("Cookie")?.includes("AUTH=sent");
    if (ticketRequest) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://jwxt.gdufs.edu.cn/sso.jsp?ticket=ST-1-fixture",
        },
      });
    }
    return withCookies(
      '<input id="pwdEncryptSalt" value="1234567890123456"><input id="execution" value="e1s1">',
      ["AUTH=login; Path=/authserver; Secure"],
    );
  }
  if (request.method === "POST" && url.pathname === "/authserver/login") {
    return withCookies(null, ["route=mfa; Path=/authserver; Secure"], {
      status: 302,
      headers: {
        Location:
          "https://authserver.gdufs.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true",
      },
    });
  }
  if (url.pathname === "/authserver/reAuthCheck/reAuthLoginView.do") {
    return new Response('<input id="username" value="138****0000">');
  }
  if (url.pathname === "/authserver/dynamicCode/getDynamicCodeByReauth.do") {
    return withCookies(
      JSON.stringify({
        res: true,
        returnMessage: "验证码已发送",
        codeTime: 60,
      }),
      ["AUTH=sent; Path=/authserver; Secure"],
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/authserver/reAuthCheck/reAuthSubmit.do") {
    return Response.json({ code: "reAuth_success" });
  }
  if (url.hostname === "jwxt.gdufs.edu.cn" && url.searchParams.has("ticket")) {
    return withCookies(null, ["SSO=first; Path=/; Secure"], { status: 302 });
  }
  if (url.hostname === "jwxt.gdufs.edu.cn" && url.searchParams.has("ticket1")) {
    return withCookies("ok", ["JSESSIONID=logged-in; Path=/; Secure"]);
  }
  if (url.pathname === "/sso.jsp") {
    return new Response(null, {
      status: 302,
      headers: {
        Location:
          "https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=ST-2-fixture",
      },
    });
  }
  if (url.pathname === "/jsxsd/framework/xsMainV_new.htmlx") {
    return new Response(`
      <html><head><title>首页</title></head><body>
        <div class="infoContentTitle qz-ellipse">脱敏姓名-20210001</div>
        <div class="qz-detailtext qz-ellipse">性别：男</div>
        <div class="qz-detailtext qz-ellipse">学院：信息科学与技术学院</div>
        <div class="qz-detailtext qz-ellipse">专业：软件工程</div>
      </body></html>
    `);
  }
  throw new Error(
    `Unexpected upstream request: ${request.method} ${request.url}`,
  );
}

function withCookies(
  body: BodyInit | null,
  cookies: string[],
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(body, { ...init, headers });
}

async function apiPost(
  path: string,
  body: unknown,
  cookies: ReadonlyMap<string, string>,
): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.test",
      "CF-Connecting-IP": "203.0.113.10",
      ...cookieHeader(cookies),
    },
    body: JSON.stringify(body),
  });
}

async function apiGet(
  path: string,
  cookies: ReadonlyMap<string, string>,
): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    headers: cookieHeader(cookies),
  });
}

function cookieHeader(
  cookies: ReadonlyMap<string, string>,
): Record<string, string> {
  return cookies.size === 0
    ? {}
    : {
        Cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
      };
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
