import { render, screen, waitFor, within } from "@testing-library/react";
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

const PERSON = {
  studentId: "20260001",
  name: "测试学生",
  college: "英语语言文化学院",
  major: "英语",
};

function sampleGrades() {
  return [
    makeGrade({
      courseName: "综合英语（一）",
      semester: "2023-2024-1",
      credits: 4,
      score: "88",
      numericScore: 88,
      gradePoint: 3.7,
    }),
    makeGrade({
      courseName: "英语听力",
      semester: "2023-2024-1",
      credits: 2,
      score: "95",
      numericScore: 95,
      gradePoint: 4.0,
      courseAttribute: "选修",
      courseCategory: "人文社科",
      assessmentMethod: "考查",
    }),
    makeGrade({
      courseName: "跨文化交际",
      semester: "2022-2023-2",
      credits: 2,
      score: "80",
      numericScore: 80,
      gradePoint: 3.0,
    }),
  ];
}

/** 按 URL 路由的 fetch 桩，避免依赖查询触发顺序。 */
function mockApi(overrides: {
  gradesPayload?: unknown;
  detail?: unknown;
  refresh?: unknown;
} = {}) {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  fetchMock.mockImplementation((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith("/api/v1/me")) {
      return Promise.resolve(jsonResponse(PERSON));
    }
    if (url.endsWith("/api/v1/grades/detail")) {
      return Promise.resolve(jsonResponse(overrides.detail ?? {}));
    }
    if (url.endsWith("/api/v1/grades/refresh")) {
      return Promise.resolve(
        jsonResponse(
          overrides.refresh ?? {
            grades: sampleGrades(),
            reachedPageLimit: false,
            retryAfterSeconds: 30,
          },
        ),
      );
    }
    if (url.endsWith("/api/v1/grades")) {
      return Promise.resolve(
        jsonResponse(
          overrides.gradesPayload ?? {
            grades: sampleGrades(),
            reachedPageLimit: false,
          },
        ),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  return fetchMock;
}

function enterGrades(overrides?: Parameters<typeof mockApi>[0]) {
  window.history.replaceState({}, "", "/grades");
  const fetchMock = mockApi(overrides);
  render(<App />);
  return fetchMock;
}

async function openSelect(triggerName: string, optionName: string) {
  await userEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const listbox = await screen.findByRole("listbox");
  await userEvent.click(
    within(listbox).getByRole("option", { name: optionName }),
  );
}

describe("grades page", () => {
  it("渲染筛选工具栏、成绩表格与课程属性徽标", async () => {
    enterGrades();

    expect(
      await screen.findByRole("heading", { name: "成绩查询" }),
    ).toBeInTheDocument();
    expect(screen.getByText("共 3 门课程")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按学期筛选" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按课程属性筛选" }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("综合英语（一）")).toBeInTheDocument();
    expect(within(table).getByText("跨文化交际")).toBeInTheDocument();
    // 课程属性与通识类别徽标
    expect(within(table).getAllByText("必修")).toHaveLength(2);
    expect(within(table).getByText("人文社科")).toBeInTheDocument();
  });

  it("按学期筛选后仅展示匹配课程，可一键清除", async () => {
    enterGrades();

    await screen.findByRole("heading", { name: "成绩查询" });
    await openSelect("按学期筛选", "2022–2023 学年第 2 学期");

    const table = screen.getByRole("table");
    expect(within(table).getByText("跨文化交际")).toBeInTheDocument();
    expect(within(table).queryByText("综合英语（一）")).not.toBeInTheDocument();
    expect(screen.getByText(/当前筛选 1 门/)).toBeInTheDocument();

    // 再选一个不可能的组合出现空态并清除
    await openSelect("按课程属性筛选", "选修");
    expect(await screen.findByText("没有符合条件的成绩")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "清除筛选条件" }),
    );
    expect(within(screen.getByRole("table")).getByText("综合英语（一）"))
      .toBeInTheDocument();
  });

  it("点击表头切换排序方向并更新 aria-sort", async () => {
    enterGrades();

    await screen.findByRole("heading", { name: "成绩查询" });
    const sortButton = screen.getByRole("button", { name: /绩点/ });
    await userEvent.click(sortButton);

    const headerCell = screen.getByRole("columnheader", { name: /绩点/ });
    expect(headerCell).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(sortButton);
    expect(headerCell).toHaveAttribute("aria-sort", "ascending");
  });

  it("打开成绩组成对话框并原样展示上游字段", async () => {
    const fetchMock = enterGrades({
      detail: { cjxm1: "期末成绩", zcj: "88", kclbmc: null },
    });

    await screen.findByRole("heading", { name: "成绩查询" });
    const triggers = screen.getAllByRole("button", {
      name: "查看 综合英语（一） 成绩组成",
    });
    const trigger = triggers.at(0);
    if (trigger === undefined) {
      throw new Error("未找到成绩组成入口按钮");
    }
    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "综合英语（一）" }),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText("cjxm1")).toBeInTheDocument();
    expect(within(dialog).getByText("期末成绩")).toBeInTheDocument();
    expect(within(dialog).getByText("zcj")).toBeInTheDocument();
    // null 值展示为占位符
    expect(within(dialog).getByText("—")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/grades/detail",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("刷新成功后写入缓存并进入 30 秒冷却", async () => {
    const refreshed = [
      makeGrade({ courseName: "高级英语", semester: "2023-2024-2" }),
    ];
    const fetchMock = enterGrades({
      refresh: {
        grades: refreshed,
        reachedPageLimit: false,
        retryAfterSeconds: 30,
      },
    });

    await screen.findByRole("heading", { name: "成绩查询" });
    await userEvent.click(
      screen.getByRole("button", { name: "刷新成绩" }),
    );

    const refreshButton = await screen.findByRole("button", {
      name: /刷新冷却中/,
    });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveTextContent("30s");
    expect(
      within(screen.getByRole("table")).getByText("高级英语"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/grades/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("导出菜单触发当前列表的 CSV 下载", async () => {
    enterGrades();
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    // jsdom 未实现这两个静态方法，直接挂到 URL 上并在结束后移除
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    try {
      await screen.findByRole("heading", { name: "成绩查询" });
      await userEvent.click(
        screen.getByRole("button", { name: "导出当前列表" }),
      );
      await userEvent.click(
        await screen.findByRole("menuitem", { name: /导出 CSV（当前列表）/ }),
      );

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("成绩为空时展示空状态引导", async () => {
    enterGrades({ gradesPayload: { grades: [], reachedPageLimit: false } });

    expect(await screen.findByText("暂无成绩数据")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "刷新成绩" }),
    ).toBeInTheDocument();
  });
});
