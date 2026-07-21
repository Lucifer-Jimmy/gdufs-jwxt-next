import { describe, expect, it } from "vitest";

import {
  compareSemesters,
  courseAttributesOf,
  currentSemester,
  earnedCredits,
  filterGrades,
  formatCredits,
  formatGpa,
  formatSemester,
  formatSemesterShort,
  generalEducationCredits,
  semesterTrend,
  semestersOf,
  sortGrades,
  weightedGpa,
} from "../src/lib/academics";
import { makeGrade } from "./fixtures";

describe("weightedGpa", () => {
  it("按 Σ(绩点×学分)/Σ学分 计算", () => {
    const grades = [
      makeGrade({ credits: 4, gradePoint: 4.0 }),
      makeGrade({ credits: 2, gradePoint: 3.0 }),
    ];
    expect(weightedGpa(grades)).toBeCloseTo((4 * 4 + 2 * 3) / 6);
  });

  it("不及格课程仍计入分子分母", () => {
    const grades = [
      makeGrade({ credits: 2, gradePoint: 4.0 }),
      makeGrade({ credits: 2, gradePoint: 0, numericScore: 45, score: "45" }),
    ];
    expect(weightedGpa(grades)).toBeCloseTo(2.0);
  });

  it("空集合与零学分返回 null", () => {
    expect(weightedGpa([])).toBeNull();
    expect(weightedGpa([makeGrade({ credits: 0 })])).toBeNull();
  });
});

describe("学分统计", () => {
  it("已修学分为全部记录学分合计", () => {
    const grades = [
      makeGrade({ credits: 3 }),
      makeGrade({ credits: 1.5 }),
      makeGrade({ credits: 2 }),
    ];
    expect(earnedCredits(grades)).toBeCloseTo(6.5);
  });

  it("通识学分只统计 courseCategory 非空的记录", () => {
    const grades = [
      makeGrade({ credits: 2, courseCategory: "人文社科" }),
      makeGrade({ credits: 3 }),
      makeGrade({ credits: 1, courseCategory: "自然科学" }),
    ];
    expect(generalEducationCredits(grades)).toBe(3);
  });
});

describe("学期工具", () => {
  it("按学年学期数值排序，异常格式回退字符串比较", () => {
    expect(compareSemesters("2023-2024-2", "2023-2024-1")).toBeGreaterThan(0);
    expect(compareSemesters("2022-2023-2", "2023-2024-1")).toBeLessThan(0);
    expect(compareSemesters("其他", "2023-2024-1")).not.toBe(0);
  });

  it("semestersOf 去重并倒序", () => {
    const grades = [
      makeGrade({ semester: "2022-2023-1" }),
      makeGrade({ semester: "2023-2024-1" }),
      makeGrade({ semester: "2022-2023-1" }),
    ];
    expect(semestersOf(grades)).toEqual(["2023-2024-1", "2022-2023-1"]);
    expect(currentSemester(grades)).toBe("2023-2024-1");
    expect(currentSemester([])).toBeNull();
  });

  it("学期标签格式化", () => {
    expect(formatSemester("2023-2024-1")).toBe("2023–2024 学年第 1 学期");
    expect(formatSemesterShort("2023-2024-1")).toBe("23-24-1");
    expect(formatSemester("未知学期")).toBe("未知学期");
    expect(formatSemesterShort("未知学期")).toBe("未知学期");
  });
});

describe("semesterTrend", () => {
  it("按学期正序输出 GPA、学分与课程数", () => {
    const grades = [
      makeGrade({ semester: "2023-2024-1", credits: 2, gradePoint: 4 }),
      makeGrade({ semester: "2022-2023-2", credits: 2, gradePoint: 3 }),
      makeGrade({ semester: "2022-2023-2", credits: 2, gradePoint: 3.4 }),
    ];
    const trend = semesterTrend(grades);
    expect(trend.map((point) => point.semester)).toEqual([
      "2022-2023-2",
      "2023-2024-1",
    ]);
    expect(trend[0]?.gpa).toBe(3.2);
    expect(trend[0]?.courseCount).toBe(2);
    expect(trend[0]?.credits).toBe(4);
    expect(trend[0]?.label).toBe("2022–2023 学年第 2 学期");
    expect(trend[1]?.gpa).toBe(4);
  });
});

describe("筛选与排序", () => {
  const grades = [
    makeGrade({
      courseName: "甲",
      semester: "2023-2024-1",
      courseAttribute: "必修",
      credits: 4,
      numericScore: 90,
    }),
    makeGrade({
      courseName: "乙",
      semester: "2023-2024-1",
      courseAttribute: "选修",
      credits: 2,
      numericScore: 76,
    }),
    makeGrade({
      courseName: "丙",
      semester: "2022-2023-2",
      courseAttribute: "必修",
      credits: 3,
      numericScore: 82,
    }),
  ];

  it("courseAttributesOf 去重排序", () => {
    expect(courseAttributesOf(grades)).toEqual(["选修", "必修"].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")));
  });

  it("按学期与课程属性筛选", () => {
    expect(
      filterGrades(grades, { semester: "2023-2024-1", courseAttribute: null }),
    ).toHaveLength(2);
    expect(
      filterGrades(grades, { semester: null, courseAttribute: "必修" }),
    ).toHaveLength(2);
    expect(
      filterGrades(grades, {
        semester: "2022-2023-2",
        courseAttribute: "选修",
      }),
    ).toHaveLength(0);
  });

  it("默认排序为学期倒序", () => {
    const sorted = sortGrades(grades, null, "desc");
    expect(sorted[0]?.semester).toBe("2023-2024-1");
    expect(sorted[2]?.semester).toBe("2022-2023-2");
  });

  it("按数值列双向排序", () => {
    const desc = sortGrades(grades, "numericScore", "desc");
    expect(desc.map((grade) => grade.numericScore)).toEqual([90, 82, 76]);
    const asc = sortGrades(grades, "credits", "asc");
    expect(asc.map((grade) => grade.credits)).toEqual([2, 3, 4]);
  });
});

describe("展示格式化", () => {
  it("GPA 保留两位，无法计算显示占位", () => {
    expect(formatGpa(3.456)).toBe("3.46");
    expect(formatGpa(null)).toBe("—");
  });

  it("学分整数不带小数点", () => {
    expect(formatCredits(6)).toBe("6");
    expect(formatCredits(6.5)).toBe("6.5");
  });
});
