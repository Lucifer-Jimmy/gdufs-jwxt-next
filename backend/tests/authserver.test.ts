import { describe, expect, it } from "vitest";

import { beginMfaLogin } from "../src/services/authserver";
import { encryptUpstreamPassword } from "../src/security/runtime-crypto";
import { UpstreamClient } from "../src/upstream/client";

const now = 1_800_000_000;

describe("authserver password protocol", () => {
  it("matches the production AES-CBC standard Base64 format", async () => {
    let offset = 0;
    const randomBytes = (length: number) => {
      const bytes = new Uint8Array(
        Array.from({ length }, (_, index) => offset + index),
      );
      offset += length;
      return bytes;
    };

    await expect(
      encryptUpstreamPassword("secret", "1234567890123456", randomBytes),
    ).resolves.toBe(
      "BQGHoM3lqYcsurCRq3PlU3Kzj7+2+v5MTmyNCPLTODwxqg3FKfjtA+HiHURR/VsKAwnGDVBA6i19TUJ7FEcGqQT0Si3Gu4c44mAkqP5hxG8=",
    );
  });
});

describe("authserver login", () => {
  it("submits the production form, preserves cookies and returns masked phone", async () => {
    const requests: Request[] = [];
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      now: () => now,
      fetcher: (input, init) => {
        const request = new Request(input, init);
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve(
            new Response(
              '<input id="pwdEncryptSalt" value="1234567890123456"><input id="execution" value="e1s1">',
              {
                headers: {
                  "Set-Cookie": "AUTH=login-cookie; Path=/authserver",
                },
              },
            ),
          );
        }
        if (requests.length === 2) {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: {
                Location:
                  "https://authserver.gdufs.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true",
                "Set-Cookie": "route=mfa-route; Path=/authserver",
              },
            }),
          );
        }
        return Promise.resolve(
          new Response('<input id="username" value="138****0000">'),
        );
      },
    });

    const result = await beginMfaLogin(
      client,
      "fixture-account",
      "fixture-password",
      now,
    );

    expect(result.maskedPhone).toBe("138****0000");
    expect(requests).toHaveLength(3);
    expect(requests[1]?.headers.get("Cookie")).toBe("AUTH=login-cookie");
    expect(requests[2]?.headers.get("Cookie")).toBe(
      "AUTH=login-cookie; route=mfa-route",
    );
    const formBody = await requests[1]?.arrayBuffer();
    if (formBody === undefined) {
      throw new Error("Expected login form body");
    }
    const form = new URLSearchParams(new TextDecoder().decode(formBody));
    expect(Object.fromEntries(form)).toMatchObject({
      username: "fixture-account",
      captcha: "",
      _eventId: "submit",
      cllt: "userNameLogin",
      dllt: "generalLogin",
      lt: "",
      execution: "e1s1",
    });
    expect(form.get("password")).not.toBe("fixture-password");
    expect(form.get("password")).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    expect(result.upstreamCookies.map((cookie) => cookie.name)).toEqual([
      "AUTH",
      "route",
    ]);
  });

  it("classifies missing MFA redirects as invalid credentials", async () => {
    let calls = 0;
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response(
                '<input id="pwdEncryptSalt" value="1234567890123456"><input id="execution" value="e1s1">',
              )
            : new Response("login failed"),
        );
      },
    });

    await expect(
      beginMfaLogin(client, "fixture-account", "wrong-password", now),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
  });

  it("classifies changed login pages without exposing the HTML", async () => {
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () => Promise.resolve(new Response("sensitive changed page")),
    });

    await expect(
      beginMfaLogin(client, "fixture-account", "fixture-password", now),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED", status: 502 });
  });
});
