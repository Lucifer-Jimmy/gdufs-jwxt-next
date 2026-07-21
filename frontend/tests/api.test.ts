import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  getGradeDetail,
  getGrades,
  isAuthError,
  login,
  refreshGrades,
  sendMfaCode,
  verifyMfaCode,
} from "../src/lib/api";
import { makeGrade } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

function jsonResponse(
  payload: unknown,
  status = 200,
  requestId = "request_5678",
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
  });
}

function errorResponse(code: string, status: number, retryAfter?: number) {
  return jsonResponse(
    {
      error: {
        code,
        message: "错误提示",
        requestId: "request_5678",
        ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
      },
    },
    status,
  );
}

describe("API response validation", () => {
  it("rejects a successful response that violates the runtime contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ maskedPhone: 138, mfaExpiresAt: "soon" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "request_5678",
        },
      }),
    );

    await expect(login("20260001", "password")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      requestId: "request_5678",
    } satisfies Partial<ApiError>);
  });
});

describe("isAuthError", () => {
  it("识别全部 401 认证错误码", async () => {
    for (const code of [
      "AUTHENTICATION_REQUIRED",
      "SESSION_EXPIRED",
      "SESSION_INVALID",
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        errorResponse(code, 401),
      );
      const error = await getGrades().catch((caught: unknown) => caught);
      expect(isAuthError(error)).toBe(true);
    }
  });

  it("业务错误与网络错误不视为认证错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      errorResponse("RATE_LIMITED", 429, 30),
    );
    const rateLimited = await getGrades().catch((caught: unknown) => caught);
    expect(isAuthError(rateLimited)).toBe(false);
    expect(rateLimited).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });

    const plain = new Error("network down");
    expect(isAuthError(plain)).toBe(false);
  });
});

describe("grades endpoints", () => {
  it("解析全量成绩响应", async () => {
    const grade = makeGrade();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ grades: [grade], reachedPageLimit: false }),
    );
    const result = await getGrades();
    expect(result.grades).toHaveLength(1);
    expect(result.grades[0]?.courseName).toBe(grade.courseName);
    expect(result.reachedPageLimit).toBe(false);
  });

  it("拒绝缺失字段的成绩记录", async () => {
    const broken = { ...makeGrade(), numericScore: "85" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ grades: [broken], reachedPageLimit: false }),
    );
    await expect(getGrades()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("刷新响应携带 retryAfterSeconds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        grades: [],
        reachedPageLimit: false,
        retryAfterSeconds: 30,
      }),
    );
    const result = await refreshGrades();
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("成绩详情原样透传键值", async () => {
    const detail = { zcj: "84", cjxm1: 66, extra: { nested: true } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(detail));
    const grade = makeGrade();
    const result = await getGradeDetail(grade.detailKey);
    expect(result).toEqual(detail);
  });
});

describe("mfa endpoints", () => {
  it("发送验证码返回提示与等待时间", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "验证码已发送", retryAfterSeconds: 60 }),
    );
    const result = await sendMfaCode();
    expect(result.retryAfterSeconds).toBe(60);
  });

  it("验证码原样提交，格式由服务端契约校验", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ authenticated: true }));
    await verifyMfaCode("123456");
    const [, init] = spy.mock.calls[0] ?? [];
    const body = init?.body;
    if (typeof body !== "string") {
      throw new Error("请求体应为 JSON 字符串");
    }
    expect(JSON.parse(body)).toEqual({ code: "123456" });
  });

  it("验证码错误映射为领域错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errorResponse("INVALID_MFA_CODE", 400),
    );
    await expect(verifyMfaCode("000000")).rejects.toMatchObject({
      code: "INVALID_MFA_CODE",
    });
  });
});
