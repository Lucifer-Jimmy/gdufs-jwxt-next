import { describe, expect, it } from "vitest";

import probeApp from "../src/probe";
import { runUpstreamProbe } from "../src/services/upstream-probe";

describe("upstream connectivity probe", () => {
  it("summarizes redirects, cookies, encoding and login fields without values", async () => {
    const requests: string[] = [];
    const fetcher = (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requests.push(url.toString());

      if (url.hostname === "authserver.gdufs.edu.cn") {
        const headers = new Headers({
          "Content-Type": "text/html; charset=UTF-8",
        });
        headers.append(
          "Set-Cookie",
          "JSESSIONID=secret-auth-cookie; Path=/authserver; Secure; HttpOnly; SameSite=Lax",
        );
        return Promise.resolve(
          new Response('<input id="pwdEncryptSalt"><input id="execution">', {
            headers,
            status: 200,
          }),
        );
      }

      return Promise.resolve(
        new Response(null, {
          headers: {
            Location:
              "https://authserver.gdufs.edu.cn/authserver/login?service=redacted",
            "Set-Cookie": "route=secret-route; Path=/; Secure; HttpOnly",
          },
          status: 302,
        }),
      );
    };

    const result = await runUpstreamProbe(fetcher);

    expect(requests).toHaveLength(3);
    expect(result.targets[0]).toMatchObject({
      charset: "utf-8",
      finalHost: "authserver.gdufs.edu.cn",
      httpsRequestSucceeded: true,
      loginFields: {
        execution: true,
        passwordEncryptSalt: true,
      },
      reachable: true,
      status: 200,
    });
    expect(result.targets[1]).toMatchObject({
      finalHost: "authserver.gdufs.edu.cn",
      redirects: [
        {
          host: "authserver.gdufs.edu.cn",
          path: "/authserver/login",
          status: 302,
        },
      ],
      reachable: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret-auth-cookie");
    expect(JSON.stringify(result)).not.toContain("secret-route");
    expect(JSON.stringify(result)).not.toContain("service=redacted");
  });

  it("rejects redirects outside the fixed school allowlist", async () => {
    const result = await runUpstreamProbe(() =>
      Promise.resolve(Response.redirect("https://example.com/login", 302)),
    );

    expect(result.targets).toHaveLength(2);
    expect(result.targets.every((target) => !target.reachable)).toBe(true);
    expect(
      result.targets.every(
        (target) => target.networkError === "redirect_rejected",
      ),
    ).toBe(true);
  });

  it("hides the route when disabled and rejects an invalid token", async () => {
    const disabled = await probeApp.request(
      "https://probe.test/__probe/upstreams",
      { method: "POST" },
      { PROBE_ENABLED: "false", PROBE_TOKEN: "fixture-token" },
    );
    const unauthorized = await probeApp.request(
      "https://probe.test/__probe/upstreams",
      {
        headers: { Authorization: "Bearer wrong-token" },
        method: "POST",
      },
      { PROBE_ENABLED: "true", PROBE_TOKEN: "fixture-token" },
    );

    expect(disabled.status).toBe(404);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.text()).not.toContain("fixture-token");
  });
});
