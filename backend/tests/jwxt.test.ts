import { describe, expect, it } from "vitest";

import {
  fetchCookiesByTicket,
  getAllGrades,
  getGradeDetail,
  getPersonalInfo,
} from "../src/services/jwxt";
import { UpstreamCookie } from "../src/upstream/cookie-jar";

const now = 1_800_000_000;
const ticketUrl = new URL(
  "https://jwxt.gdufs.edu.cn/sso.jsp?ticket=ST-1-fixture",
);

const jwxtCookies: UpstreamCookie[] = [
  {
    name: "JSESSIONID",
    value: "fixture-session",
    domain: "jwxt.gdufs.edu.cn",
    path: "/",
    hostOnly: true,
    secure: true,
  },
];

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

describe("JWXT SSO exchange", () => {
  it("performs ticket, sso, and ticket1 requests in exact order", async () => {
    const requests: Request[] = [];
    const cookies = await fetchCookiesByTicket(
      ticketUrl,
      1_000,
      now,
      (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length === 1) {
          return Promise.resolve(
            response(null, {
              status: 302,
              headers: {
                "Set-Cookie": "SSO=auth; Path=/",
              },
            }),
          );
        }
        if (requests.length === 2) {
          return Promise.resolve(
            response(null, {
              status: 302,
              headers: {
                Location:
                  "https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=ST-2-fixture",
              },
            }),
          );
        }
        return Promise.resolve(
          response("ok", {
            headers: {
              "Set-Cookie": "JSESSIONID=jwxt-session; Path=/jsxsd",
            },
          }),
        );
      },
    );

    expect(
      requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "GET https://jwxt.gdufs.edu.cn/sso.jsp?ticket=ST-1-fixture",
      "GET https://jwxt.gdufs.edu.cn/sso.jsp",
      "GET https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=ST-2-fixture",
    ]);
    expect(requests[1]?.headers.get("Cookie")).toBe("SSO=auth");
    expect(requests[2]?.headers.get("Cookie")).toBe("SSO=auth");
    expect(cookies.map((cookie) => cookie.name)).toEqual(["SSO", "JSESSIONID"]);
  });

  it("rejects missing or untrusted ticket1 locations", async () => {
    for (const location of [
      undefined,
      "https://attacker.example/sso.jsp?ticket1=ST-2",
      "https://jwxt.gdufs.edu.cn/other?ticket1=ST-2",
    ]) {
      const result = fetchCookiesByTicket(ticketUrl, 1_000, now, () =>
        Promise.resolve(
          response(null, {
            status: 302,
            ...(location === undefined
              ? {}
              : { headers: { Location: location } }),
          }),
        ),
      );
      await expect(result).rejects.toMatchObject({
        code: "TICKET_NOT_FOUND",
        status: 502,
      });
    }
  });

  it("reports a redacted ticket1 failure category", async () => {
    const stages: string[] = [];
    await expect(
      fetchCookiesByTicket(
        ticketUrl,
        1_000,
        now,
        () => Promise.resolve(response(null, { status: 302 })),
        (stage) => stages.push(stage),
      ),
    ).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" });

    expect(stages).toEqual(["jwxt_ticket1_location_missing"]);
  });

  it("separates rejected ticket1 protocol, host, and path", async () => {
    const cases = [
      [
        "http://jwxt.gdufs.edu.cn/sso.jsp?ticket1=ST-2",
        "jwxt_ticket1_protocol_rejected",
      ],
      [
        "https://authserver.gdufs.edu.cn/sso.jsp?ticket1=ST-2",
        "jwxt_ticket1_host_rejected",
      ],
      [
        "https://jwxt.gdufs.edu.cn/other?ticket1=ST-2",
        "jwxt_ticket1_path_rejected",
      ],
      [
        "https://jwxt.gdufs.edu.cn/jsxsd/framework/xsMainV_new.htmlx?ticket1=ST-2",
        "jwxt_ticket1_path_rejected",
      ],
    ] as const;

    for (const [location, expectedStage] of cases) {
      const stages: string[] = [];
      await expect(
        fetchCookiesByTicket(
          ticketUrl,
          1_000,
          now,
          (_input, init) => {
            const request = new Request(_input, init);
            return Promise.resolve(
              request.url === "https://jwxt.gdufs.edu.cn/sso.jsp"
                ? response(null, {
                    status: 302,
                    headers: { Location: location },
                  })
                : response(null),
            );
          },
          (stage) => stages.push(stage),
        ),
      ).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" });
      expect(stages).toEqual([expectedStage]);
    }
  });

  it("accepts a long ticket1 from the trusted SSO endpoint", async () => {
    const ticket1 = `ST-${"b".repeat(512)}`;
    const requests: Request[] = [];
    const cookies = await fetchCookiesByTicket(
      ticketUrl,
      1_000,
      now,
      (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length === 2) {
          return Promise.resolve(
            response(null, {
              status: 302,
              headers: {
                Location: `https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=${ticket1}`,
              },
            }),
          );
        }
        return Promise.resolve(
          response(null, {
            headers: {
              "Set-Cookie": "JSESSIONID=jwxt-session; Path=/jsxsd",
            },
          }),
        );
      },
    );

    expect(requests[2]?.url).toBe(
      `https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=${ticket1}`,
    );
    expect(cookies.map((cookie) => cookie.name)).toContain("JSESSIONID");
  });

  it("rejects a successful ticket exchange that sets no JWXT cookie", async () => {
    const result = fetchCookiesByTicket(
      ticketUrl,
      1_000,
      now,
      (_input, init) => {
        const request = new Request(_input, init);
        if (request.url.includes("ticket=ST-1-fixture")) {
          return Promise.resolve(response(null, { status: 302 }));
        }
        if (request.url === "https://jwxt.gdufs.edu.cn/sso.jsp") {
          return Promise.resolve(
            response(null, {
              status: 302,
              headers: {
                Location:
                  "https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=ST-2-fixture",
              },
            }),
          );
        }
        return Promise.resolve(response("ok"));
      },
    );

    await expect(result).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  });

  it("rejects an exchange that only leaves a Cookie scoped to sso.jsp", async () => {
    let calls = 0;
    const result = fetchCookiesByTicket(ticketUrl, 1_000, now, () => {
      calls += 1;
      if (calls === 2) {
        return Promise.resolve(
          response(null, {
            status: 302,
            headers: {
              Location:
                "https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=ST-2-fixture",
            },
          }),
        );
      }
      return Promise.resolve(
        response("ok", {
          headers: {
            "Set-Cookie": "SSO_ONLY=exchange; Path=/sso.jsp; Secure",
          },
        }),
      );
    });

    await expect(result).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  });
});

describe("JWXT personal information", () => {
  it("parses the old production page fields", async () => {
    await expect(
      getPersonalInfo(jwxtCookies, 1_000, now, (input, init) => {
        const request = new Request(input, init);
        expect(request.headers.get("Cookie")).toBe(
          "JSESSIONID=fixture-session",
        );
        return Promise.resolve(
          response(`
              <html><head><title>首页</title></head><body>
                <div class="infoContentTitle qz-ellipse">脱敏姓名-20210001</div>
                <div class="qz-detailtext qz-ellipse">性别：男</div>
                <div class="qz-detailtext qz-ellipse">学院：信息科学与技术学院</div>
                <div class="qz-detailtext qz-ellipse">专业：软件工程</div>
              </body></html>
            `),
        );
      }),
    ).resolves.toEqual({
      studentId: "20210001",
      name: "脱敏姓名",
      college: "信息科学与技术学院",
      major: "软件工程",
    });
  });

  it("classifies login and changed pages without exposing page contents", async () => {
    const login = getPersonalInfo(jwxtCookies, 1_000, now, () =>
      Promise.resolve(
        response("<html><title>登录</title><form id=loginForm></form></html>"),
      ),
    );
    await expect(login).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      status: 401,
    });

    const changed = getPersonalInfo(jwxtCookies, 1_000, now, () =>
      Promise.resolve(response("<html>changed upstream fixture</html>")),
    );
    await expect(changed).rejects.toMatchObject({
      code: "UPSTREAM_CHANGED",
      status: 502,
    });
  });
});

describe("JWXT grades", () => {
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

  it("uses the fixed all-grades query and authenticated Cookie", async () => {
    const requests: Request[] = [];
    await expect(
      getAllGrades(jwxtCookies, 1_000, now, (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Promise.resolve(
          response(JSON.stringify({ code: 0, data: [grade] }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    ).resolves.toMatchObject({
      reachedPageLimit: false,
      grades: [{ courseName: "高等数学", credits: 4 }],
    });

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "https://invalid.test");
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://jwxt.gdufs.edu.cn/jsxsd/kscj/cjcx_list",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      pageNum: "1",
      pageSize: "300",
      kksj: "",
      kcxz: "",
      kcsx: "",
      kcmc: "",
      xsfs: "all",
      sfxsbcxq: "1",
    });
    expect(requests[0]?.headers.get("Cookie")).toBe(
      "JSESSIONID=fixture-session",
    );
    expect(requests[0]?.headers.get("Origin")).toBe(
      "https://authserver.gdufs.edu.cn",
    );
    expect(requests[0]?.headers.get("Referer")).toBeNull();
  });

  it("classifies non-JSON, untrusted redirects, and upstream failures", async () => {
    await expect(
      getAllGrades(jwxtCookies, 1_000, now, () =>
        Promise.resolve(response("<html><title>登录</title></html>")),
      ),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });

    await expect(
      getAllGrades(jwxtCookies, 1_000, now, () =>
        Promise.resolve(
          response(null, {
            status: 302,
            headers: { Location: "https://attacker.example/steal" },
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });

    await expect(
      getAllGrades(jwxtCookies, 1_000, now, () =>
        Promise.resolve(response("gateway failure", { status: 503 })),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE", status: 502 });
  });

  it("requests grade detail with encoded parameters and preserves component semantics", async () => {
    const requests: Request[] = [];
    await expect(
      getGradeDetail(
        jwxtCookies,
        {
          studentKey: "student / fixture",
          teachingClassKey: "class&fixture",
          gradeRecordKey: "record?fixture",
          totalScore: "84",
        },
        1_000,
        now,
        (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return Promise.resolve(
            response(
              '<script>let arr = [{"cjxm1":66,"zcj":"84","cjxm3":96,"cjxm2":0,"cjxm3bl":"60%","cjxm2bl":"0%","cjxm1bl":"40%"}];</script>',
            ),
          );
        },
      ),
    ).resolves.toEqual({
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
    expect(requests[0]?.headers.get("Cookie")).toBe(
      "JSESSIONID=fixture-session",
    );
  });

  it("treats a detail login page as an expired JWXT session", async () => {
    await expect(
      getGradeDetail(
        jwxtCookies,
        {
          studentKey: "student",
          teachingClassKey: "class",
          gradeRecordKey: "record",
          totalScore: "84",
        },
        1_000,
        now,
        () =>
          Promise.resolve(
            response("<html><title>登录</title><form id=loginForm></form>"),
          ),
      ),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
  });
});
