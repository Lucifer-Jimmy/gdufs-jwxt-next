import { render, screen, within } from "@testing-library/react";
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

const PERSON = {
  studentId: "20260001",
  name: "测试学生",
  college: "英语语言文化学院",
  major: "英语",
};

function enterOverview(grades = sampleGrades()) {
  window.history.replaceState({}, "", "/overview");
  const fetchMock = vi.spyOn(globalThis, "fetch");
  fetchMock.mockResolvedValueOnce(jsonResponse(PERSON));
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ grades, reachedPageLimit: false }),
  );
  render(<App />);
  return fetchMock;
}

function sampleGrades() {
  return [
    makeGrade({
      courseName: "综合英语（一）",
      semester: "2023-2024-1",
      credits: 4,
      gradePoint: 3.7,
      numericScore: 88,
    }),
    makeGrade({
      courseName: "英语听力",
      semester: "2023-2024-1",
      credits: 2,
      gradePoint: 4.0,
      numericScore: 95,
      courseCategory: "人文社科",
    }),
    makeGrade({
      courseName: "跨文化交际",
      semester: "2022-2023-2",
      credits: 2,
      gradePoint: 3.0,
      numericScore: 80,
    }),
  ];
}

describe("overview page", () => {
  it("展示关键指标、分学期趋势与规则降级提示", async () => {
    enterOverview();

    expect(
      await screen.findByRole("heading", { name: "学业概览" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/英语语言文化学院 · 英语/)).toBeInTheDocument();

    // 指标带：总 GPA = (3.7×4 + 4×2 + 3×2) / 8 = 3.6 → 3.60（两位小数）
    const band = screen.getByLabelText("关键学业指标");
    expect(within(band).getByText("总平均绩点")).toBeInTheDocument();
    expect(within(band).getByText("3.60")).toBeInTheDocument();
    expect(within(band).getByText("本学期绩点")).toBeInTheDocument();
    // 本学期 = 2023-2024-1：(3.7×4+4×2)/6 = 3.8
    expect(within(band).getByText("3.80")).toBeInTheDocument();
    expect(within(band).getByText("已修学分")).toBeInTheDocument();
    expect(within(band).getByText("8")).toBeInTheDocument();

    // 趋势区提供等价数据表
    expect(
      screen.getByRole("heading", { name: "分学期趋势" }),
    ).toBeInTheDocument();
    expect(screen.getByText("查看数据表")).toBeInTheDocument();

    // 专业未配置规则时安全降级，不展示完成比例
    expect(
      screen.getByText(/该专业规则暂未配置或无法准确匹配/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/通识课程 2 学分/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("成绩为空时给出空状态引导", async () => {
    enterOverview([]);

    expect(await screen.findByText("暂无成绩数据")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "成绩页" }),
    ).toBeInTheDocument();
  });

  it("成绩接口失败时原位展示错误与请求编号", async () => {
    window.history.replaceState({}, "", "/overview");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(jsonResponse(PERSON));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "UPSTREAM_TIMEOUT",
            message: "教务系统响应超时，请稍后重试。",
            requestId: "req_grades",
          },
        },
        504,
      ),
    );
    render(<App />);

    expect(
      await screen.findByText("教务系统响应超时，请稍后重试。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/req_grades/)).toBeInTheDocument();
  });

  it("登录态失效时回到登录页", async () => {
    window.history.replaceState({}, "", "/overview");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "SESSION_EXPIRED",
            message: "认证会话已过期，请重新登录",
            requestId: "req_expired",
          },
        },
        401,
      ),
    );
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "登录" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/登录状态已过期/)).toBeInTheDocument();
  });
});
