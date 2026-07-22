import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("login page", () => {
  it("shows field feedback without sending an empty request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByText("请输入学号和统一认证密码")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits credentials and continues to the MFA status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            maskedPhone: "138****1234",
            mfaExpiresAt: "2026-07-20T10:10:00+08:00",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            maskedPhone: "138****1234",
            codeSent: false,
            retryAfterSeconds: 0,
            expiresAt: "2026-07-20T10:10:00+08:00",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    render(<App />);

    await userEvent.type(screen.getByLabelText("学号"), "20260001");
    await userEvent.type(screen.getByLabelText("统一认证密码"), "password");
    await userEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(
      await screen.findByRole("heading", { name: "验证手机号" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/138\*{4}1234/u)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ username: "20260001", password: "password" }),
      }),
    );
  });

  it("keeps server errors in context with the request ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "账号或密码不正确。",
            requestId: "request_1234",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(<App />);

    await userEvent.type(screen.getByLabelText("学号"), "20260001");
    await userEvent.type(screen.getByLabelText("统一认证密码"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("账号或密码不正确。"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("request_1234");
    expect(screen.getByLabelText("统一认证密码")).toHaveValue("");
  });
});
