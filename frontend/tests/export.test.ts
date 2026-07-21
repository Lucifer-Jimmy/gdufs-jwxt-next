import { describe, expect, it } from "vitest";

import {
  exportFileBasename,
  GRADE_EXPORT_HEADERS,
  gradesToCsv,
  gradesToRows,
} from "../src/lib/export";
import { makeGrade } from "./fixtures";

describe("gradesToRows", () => {
  it("按导出列顺序映射字段，通识类别空值置空串", () => {
    const rows = gradesToRows([
      makeGrade({
        courseCode: "ENG1001",
        courseName: "综合英语",
        semester: "2023-2024-1",
        credits: 4,
        score: "优秀",
        numericScore: 92,
        gradePoint: 4,
        assessmentMethod: "考试",
        courseAttribute: "必修",
        courseCategory: null,
      }),
    ]);
    expect(rows).toEqual([
      [
        "ENG1001",
        "综合英语",
        "2023–2024 学年第 1 学期",
        4,
        "优秀",
        92,
        4,
        "考试",
        "必修",
        "",
      ],
    ]);
  });
});

describe("gradesToCsv", () => {
  it("带 BOM 并转义引号与逗号", () => {
    const csv = gradesToCsv([
      makeGrade({ courseName: '英语（"高级"）, 上' }),
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"英语（""高级""）, 上"');
    const header = csv.split("\r\n")[0];
    expect(header?.replace(/^\ufeff/, "")).toBe(
      GRADE_EXPORT_HEADERS.map((name) => `"${name}"`).join(","),
    );
  });

  it("空数据只有表头", () => {
    const csv = gradesToCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
  });
});

describe("exportFileBasename", () => {
  it("使用本地时间生成稳定文件名", () => {
    expect(exportFileBasename(new Date(2026, 6, 20, 9, 5))).toBe(
      "成绩-20260720-0905",
    );
  });
});
