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
});

describe("upstream client", () => {
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
});
