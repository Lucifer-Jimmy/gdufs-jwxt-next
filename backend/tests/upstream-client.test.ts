import { describe, expect, it } from "vitest";

import { UpstreamClient } from "../src/upstream/client";
import { UpstreamCookieJar } from "../src/upstream/cookie-jar";

const now = 1_800_000_000;

describe("upstream cookie jar", () => {
  it("captures scoped cookies and serializes only unexpired state", () => {
    const jar = new UpstreamCookieJar();
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      "AUTH=fixture-auth; Path=/authserver; Secure; HttpOnly; Max-Age=600",
    );
    headers.append("Set-Cookie", "route=fixture-route; Path=/");
    jar.capture(
      new Response(null, { headers }),
      new URL("https://authserver.gdufs.edu.cn/authserver/login"),
      now,
    );

    expect(
      jar.header(
        new URL("https://authserver.gdufs.edu.cn/authserver/login"),
        now,
      ),
    ).toBe("AUTH=fixture-auth; route=fixture-route");
    expect(
      jar.header(new URL("https://authserver.gdufs.edu.cn/other"), now),
    ).toBe("route=fixture-route");
    expect(jar.serialize(now + 600)).toEqual([
      expect.objectContaining({ name: "route", value: "fixture-route" }),
    ]);
  });

  it("replaces a cookie in place without changing creation order", () => {
    const jar = new UpstreamCookieJar();
    const requestUrl = new URL(
      "https://authserver.gdufs.edu.cn/authserver/login",
    );

    for (const serialized of [
      "AUTH=first; Path=/authserver",
      "route=first; Path=/authserver",
      "AUTH=second; Path=/authserver",
    ]) {
      jar.capture(
        new Response(null, { headers: { "Set-Cookie": serialized } }),
        requestUrl,
        now,
      );
    }

    expect(jar.header(requestUrl, now)).toBe("AUTH=second; route=first");
  });

  it("rejects a cookie Domain outside the response host", () => {
    const jar = new UpstreamCookieJar();
    jar.capture(
      new Response(null, {
        headers: { "Set-Cookie": "AUTH=secret; Domain=example.com; Path=/" },
      }),
      new URL("https://authserver.gdufs.edu.cn/authserver/login"),
      now,
    );

    expect(jar.serialize(now)).toEqual([]);
  });

  it("rejects an overbroad parent Domain instead of failing session state", () => {
    const jar = new UpstreamCookieJar();
    jar.capture(
      new Response(null, {
        headers: { "Set-Cookie": "route=fixture; Domain=edu.cn; Path=/" },
      }),
      new URL("https://authserver.gdufs.edu.cn/authserver/login"),
      now,
    );

    expect(jar.serialize(now)).toEqual([]);
  });

  it("accepts school parent and subdomain Cookie domains", () => {
    const jar = new UpstreamCookieJar();
    const requestUrl = new URL(
      "https://authserver.gdufs.edu.cn/authserver/login",
    );
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      "parent=fixture; Domain=.gdufs.edu.cn; Path=/authserver",
    );
    headers.append(
      "Set-Cookie",
      "host=fixture; Domain=authserver.gdufs.edu.cn; Path=/authserver",
    );

    jar.capture(new Response(null, { headers }), requestUrl, now);

    expect(jar.serialize(now).map((cookie) => cookie.domain)).toEqual([
      "gdufs.edu.cn",
      "authserver.gdufs.edu.cn",
    ]);
  });

  it("serializes only cookies that a target URL would receive", () => {
    const jar = new UpstreamCookieJar([
      {
        name: "SSO_ONLY",
        value: "exchange",
        domain: "jwxt.gdufs.edu.cn",
        path: "/sso.jsp",
        hostOnly: true,
        secure: true,
      },
      {
        name: "JSESSIONID",
        value: "fixture-session",
        domain: "jwxt.gdufs.edu.cn",
        path: "/jsxsd",
        hostOnly: true,
        secure: true,
      },
    ]);

    expect(
      jar
        .serializeFor(
          new URL(
            "https://jwxt.gdufs.edu.cn/jsxsd/framework/xsMainV_new.htmlx",
          ),
          now,
        )
        .map((cookie) => cookie.name),
    ).toEqual(["JSESSIONID"]);
  });
});

describe("upstream client", () => {
  it("calls the runtime fetch without binding the client as its receiver", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function () {
      expect(this).toBeUndefined();
      return Promise.resolve(new Response("ok"));
    };

    try {
      const client = new UpstreamClient({ timeoutMs: 1_000 });
      const response = await client.request(
        new URL("https://authserver.gdufs.edu.cn/authserver/login"),
      );

      expect(await response.text()).toBe("ok");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("follows only allowlisted redirects and carries captured cookies", async () => {
    const requests: Request[] = [];
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      now: () => now,
      fetcher: (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length === 1) {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: {
                Location: "/authserver/reAuthCheck/reAuthLoginView.do",
                "Set-Cookie": "AUTH=fixture; Path=/authserver; Secure",
              },
            }),
          );
        }
        return Promise.resolve(new Response("ok"));
      },
    });

    const response = await client.request(
      new URL("https://authserver.gdufs.edu.cn/authserver/login"),
    );

    expect(await response.text()).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get("Cookie")).toBe("AUTH=fixture");
    expect(requests.every((request) => request.redirect === "manual")).toBe(
      true,
    );
  });

  it("rejects untrusted initial and redirect URLs", async () => {
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () =>
        Promise.resolve(Response.redirect("https://example.com/login", 302)),
    });

    await expect(
      client.request(new URL("https://example.com/login")),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });
    await expect(
      client.request(new URL("https://authserver.gdufs.edu.cn/admin")),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });
    await expect(
      client.request(
        new URL("https://authserver.gdufs.edu.cn/authserver/login"),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });
  });

  it("returns a manual redirect without following it", async () => {
    let calls = 0;
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () => {
        calls += 1;
        return Promise.resolve(
          Response.redirect(
            "https://authserver.gdufs.edu.cn/authserver/reAuthCheck/reAuthLoginView.do",
            302,
          ),
        );
      },
    });

    const response = await client.requestManual(
      new URL("https://authserver.gdufs.edu.cn/authserver/login"),
    );

    expect(response.status).toBe(302);
    expect(calls).toBe(1);
  });

  it("allows only the verified JWXT ticket exchange path", async () => {
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () => Promise.resolve(new Response("ok")),
    });

    await expect(
      client.requestManual(
        new URL("https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=fixture"),
      ),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      client.requestManual(
        new URL("https://jwxt.gdufs.edu.cn/jsxsd/sso.jsp?ticket1=fixture"),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });
    await expect(
      client.requestManual(
        new URL("https://jwxt.gdufs.edu.cn/jsxsd/other?ticket1=fixture"),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });
  });
});
