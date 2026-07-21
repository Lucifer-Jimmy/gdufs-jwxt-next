import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app";
import { makeGrade } from "./fixtures";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mfaStatus(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    maskedPhone: "138****1234",
    codeSent: false,
    retryAfterSeconds: 0,
    expiresAt: "2026-07-20T10:10:00+08:00",
    ...overrides,
  });
}

function enterMfaPage() {
  window.history.replaceState({}, "", "/mfa");
  render(<App />);
}

describe("mfa page", () => {
  it("发送验证码后展示 OTP 输入并启动重发倒计时", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(mfaStatus());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "验证码已发送", retryAfterSeconds: 60 }),
    );
    enterMfaPage();

    const sendButton = await screen.findByRole("button", {
      name: "发送验证码",
    });
    await userEvent.click(sendButton);

    expect(await screen.findByLabelText("短信验证码")).toBeInTheDocument();
    expect(screen.getByText(/60 秒后可重新发送/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新发送" }),
    ).toBeDisabled();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/mfa/send",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("输入 6 位验证码自动提交并进入概览页", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(mfaStatus({ codeSent: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: true }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        studentId: "20260001",
        name: "测试学生",
        college: "示例学院",
        major: "示例专业",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ grades: [makeGrade()], reachedPageLimit: false }),
    );
    enterMfaPage();

    const input = await screen.findByLabelText("短信验证码");
    await userEvent.type(input, "654321");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/mfa/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "654321" }),
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "学业概览" }),
    ).toBeInTheDocument();
  });

  it("验证码错误时清空输入并在字段处提示", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(mfaStatus({ codeSent: true }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "INVALID_MFA_CODE",
            message: "验证码不正确，请重新输入。",
            requestId: "req_code",
          },
        },
        400,
      ),
    );
    enterMfaPage();

    const input = await screen.findByLabelText("短信验证码");
    await userEvent.type(input, "000000");

    expect(
      await screen.findByText("验证码不正确，请重新输入。"),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("验证次数过多时引导重新登录", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(mfaStatus({ codeSent: true }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "RATE_LIMITED",
            message: "验证码尝试次数过多，请重新登录。",
            requestId: "req_rate",
            retryAfterSeconds: 600,
          },
        },
        429,
      ),
    );
    enterMfaPage();

    const input = await screen.findByLabelText("短信验证码");
    await userEvent.type(input, "000000");

    expect(
      await screen.findByText(/验证码尝试次数过多，验证流程已结束/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "重新登录" }),
    ).toBeInTheDocument();
  });

  it("MFA 状态缺失时回到登录页并提示", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "请先登录",
            requestId: "req_none",
          },
        },
        401,
      ),
    );
    enterMfaPage();

    expect(
      await screen.findByRole("heading", { name: "登录" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/验证流程已过期/)).toBeInTheDocument();
  });

  it("已发送状态下页面恢复时同步服务端剩余冷却", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mfaStatus({ codeSent: true, retryAfterSeconds: 42 }),
    );
    enterMfaPage();

    expect(
      await screen.findByText(/42 秒后可重新发送/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重新发送" })).toBeDisabled(),
    );
  });
});
