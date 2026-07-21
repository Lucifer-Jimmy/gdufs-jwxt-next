import { describe, expect, it } from "vitest";

import {
  beginMfaLogin,
  getTicketToLogin,
  sendMfaCode,
  verifyMfaCode,
} from "../src/services/authserver";
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
      "IoN17gREmExE5kq3wRjznl/ek2uEGRzn+832Poe4LxvnYZP5TTEOJm8tdfh/QMUyOJUl/twJaVG7USWVs93Blcn/BVqGEdUd11tBqGM6tPk=",
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
                "Set-Cookie":
                  "route=mfa-route; Domain=.gdufs.edu.cn; Path=/authserver",
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
    expect(result.upstreamCookies[1]?.domain).toBe("gdufs.edu.cn");
    expect(result.upstreamCookies[1]?.hostOnly).toBe(false);
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

  it("sends MFA using the production form and keeps the auth cookie jar", async () => {
    const requests: Request[] = [];
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      now: () => now,
      fetcher: (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              res: true,
              mobile: "138****0000",
              returnMessage: "验证码已发送至手机",
              codeTime: 45,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": "AUTH=refreshed; Path=/authserver",
              },
            },
          ),
        );
      },
    });

    client.jar.capture(
      new Response(null, {
        headers: { "Set-Cookie": "AUTH=initial; Path=/authserver" },
      }),
      new URL("https://authserver.gdufs.edu.cn/authserver/login"),
      now,
    );

    await expect(sendMfaCode(client, "fixture-account")).resolves.toEqual({
      message: "验证码已发送至手机",
      codeTimeSeconds: 45,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      "https://authserver.gdufs.edu.cn/authserver/dynamicCode/getDynamicCodeByReauth.do",
    );
    expect(requests[0]?.headers.get("Cookie")).toBe("AUTH=initial");
    expect(requests[0]?.headers.get("Referer")).toBe(
      "https://authserver.gdufs.edu.cn/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
    );
    const body = await requests[0]?.arrayBuffer();
    const form = new URLSearchParams(
      body === undefined ? "" : new TextDecoder().decode(body),
    );
    expect(Object.fromEntries(form)).toEqual({
      userName: "fixture-account",
      authCodeTypeName: "reAuthDynamicCodeType",
    });
    expect(client.jar.serialize(now).map((cookie) => cookie.value)).toEqual([
      "refreshed",
    ]);
  });

  it("accepts the codeTime representation handled by the origin implementation", async () => {
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () =>
        Promise.resolve(Response.json({ res: true, codeTime: "45" })),
    });

    await expect(sendMfaCode(client, "fixture-account")).resolves.toMatchObject(
      {
        codeTimeSeconds: 45,
      },
    );
  });

  it("preserves the origin implementation's truthy MFA success flag", async () => {
    for (const res of [1, "true", "success"]) {
      const client = new UpstreamClient({
        timeoutMs: 1_000,
        fetcher: () => Promise.resolve(Response.json({ res, codeTime: 45 })),
      });

      await expect(sendMfaCode(client, "fixture-account")).resolves.toMatchObject(
        { codeTimeSeconds: 45 },
      );
    }
  });

  it("ignores malformed optional MFA send fields after confirmed success", async () => {
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () =>
        Promise.resolve(
          Response.json({
            res: true,
            mobile: null,
            returnMessage: null,
            codeTime: "not-a-delay",
          }),
        ),
    });

    await expect(sendMfaCode(client, "fixture-account")).resolves.toEqual({
      message: "验证码已发送",
      codeTimeSeconds: 60,
    });
  });

  it("rejects malformed or unsuccessful MFA send responses", async () => {
    await expect(
      sendMfaCode(
        new UpstreamClient({
          timeoutMs: 1_000,
          fetcher: () => Promise.resolve(new Response("not-json")),
        }),
        "fixture-account",
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED", status: 502 });

    await expect(
      sendMfaCode(
        new UpstreamClient({
          timeoutMs: 1_000,
          fetcher: () =>
            Promise.resolve(
              new Response(JSON.stringify({ res: false }), {
                headers: { "Content-Type": "application/json" },
              }),
            ),
        }),
        "fixture-account",
      ),
    ).rejects.toMatchObject({ code: "MFA_SEND_FAILED", status: 502 });

    for (const res of [false, 0, "", null, []]) {
      await expect(
        sendMfaCode(
          new UpstreamClient({
            timeoutMs: 1_000,
            fetcher: () => Promise.resolve(Response.json({ res })),
          }),
          "fixture-account",
        ),
      ).rejects.toMatchObject({ code: "MFA_SEND_FAILED", status: 502 });
    }
  });

  it("verifies MFA with every production field and fetches the ticket afterwards", async () => {
    const requests: Request[] = [];
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      now: () => now,
      fetcher: (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ code: "reAuth_success" }), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              Location: "https://jwxt.gdufs.edu.cn/sso.jsp?ticket=ST-1-fixture",
            },
          }),
        );
      },
    });

    await expect(verifyMfaCode(client, "123456")).resolves.toEqual(
      new URL("https://jwxt.gdufs.edu.cn/sso.jsp?ticket=ST-1-fixture"),
    );
    expect(
      requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "POST https://authserver.gdufs.edu.cn/authserver/reAuthCheck/reAuthSubmit.do",
      "GET https://authserver.gdufs.edu.cn/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
    ]);
    const formBody = await requests[0]!.arrayBuffer();
    const form = new URLSearchParams(new TextDecoder().decode(formBody));
    expect(Object.fromEntries(form)).toEqual({
      service: "https://jwxt.gdufs.edu.cn/sso.jsp",
      reAuthType: "3",
      isMultifactor: "true",
      password: "",
      dynamicCode: "123456",
      uuid: "",
      answer1: "",
      answer2: "",
      optCode: "",
      skipTmpReAuth: "false",
    });
  });

  it("accepts a long CAS ticket from the trusted SSO endpoint", async () => {
    const ticket = `ST-${"a".repeat(512)}`;
    const client = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              Location: `https://jwxt.gdufs.edu.cn/sso.jsp?ticket=${ticket}`,
            },
          }),
        ),
    });

    await expect(getTicketToLogin(client)).resolves.toEqual(
      new URL(`https://jwxt.gdufs.edu.cn/sso.jsp?ticket=${ticket}`),
    );
  });

  it("rejects invalid MFA codes and untrusted ticket locations", async () => {
    const invalidClient = new UpstreamClient({
      timeoutMs: 1_000,
      fetcher: () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: "reAuth_failed" }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    });
    await expect(verifyMfaCode(invalidClient, "000000")).rejects.toMatchObject({
      code: "INVALID_MFA_CODE",
      status: 401,
    });

    for (const location of [
      "https://attacker.example/sso.jsp?ticket=ST-1",
      "https://jwxt.gdufs.edu.cn/other?ticket=ST-1",
      "https://jwxt.gdufs.edu.cn/sso.jsp",
    ]) {
      const client = new UpstreamClient({
        timeoutMs: 1_000,
        fetcher: () =>
          Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { Location: location },
            }),
          ),
      });
      await expect(getTicketToLogin(client)).rejects.toMatchObject({
        code: "TICKET_NOT_FOUND",
        status: 502,
      });
    }
  });
});
