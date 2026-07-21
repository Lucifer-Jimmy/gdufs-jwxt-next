import { describe, expect, it } from "vitest";

import {
  computeRuleProgress,
  majorRuleSchema,
  matchMajorRule,
  normalizeMajorName,
  type MajorRule,
} from "../src/lib/rules";
import { MAJOR_RULES } from "../src/lib/rules-data";
import { makeGrade } from "./fixtures";

/** 测试用规则，不进入生产规则表。 */
function makeRule(overrides: Partial<MajorRule> = {}): MajorRule {
  return {
    ruleId: "rule-cs-2024",
    majors: ["计算机科学与技术"],
    aliases: ["计算机科学"],
    version: "2024.1",
    totalCreditsRequired: 160,
    generalEducationCreditsRequired: 12,
    source: {
      title: "测试用培养方案（虚构）",
      checkedAt: "2026-07-01",
    },
    ...overrides,
  };
}

describe("majorRuleSchema", () => {
  it("接受完整规则", () => {
    expect(majorRuleSchema.safeParse(makeRule()).success).toBe(true);
  });

  it("拒绝缺少来源或非法学分的规则", () => {
    const noSource = { ...makeRule(), source: undefined };
    expect(majorRuleSchema.safeParse(noSource).success).toBe(false);
    expect(
      majorRuleSchema.safeParse(makeRule({ totalCreditsRequired: 0 })).success,
    ).toBe(false);
    expect(
      majorRuleSchema.safeParse(
        makeRule({ source: { title: "x", checkedAt: "不是日期" } }),
      ).success,
    ).toBe(false);
  });

  it("拒绝未声明字段", () => {
    const extra = { ...makeRule(), comment: "不允许" };
    expect(majorRuleSchema.safeParse(extra).success).toBe(false);
  });
});

describe("normalizeMajorName", () => {
  it("去空白并统一括号", () => {
    expect(normalizeMajorName("  计算机科学与技术 ")).toBe("计算机科学与技术");
    expect(normalizeMajorName("软件工程（实验班）")).toBe("软件工程(实验班)");
    expect(normalizeMajorName("英语 （ 师范 ）")).toBe("英语(师范)");
  });
});

describe("matchMajorRule", () => {
  const rules = [
    makeRule(),
    makeRule({
      ruleId: "rule-en-2024",
      majors: ["英语"],
      aliases: [],
    }),
  ];

  it("精确匹配专业名与别名", () => {
    expect(matchMajorRule("计算机科学与技术", rules)).toMatchObject({
      status: "matched",
      rule: { ruleId: "rule-cs-2024" },
    });
    expect(matchMajorRule("计算机科学", rules)).toMatchObject({
      status: "matched",
    });
  });

  it("规范化后匹配（全角括号、多余空白）", () => {
    const rule = makeRule({ majors: ["软件工程(实验班)"], aliases: [] });
    expect(matchMajorRule("软件工程（实验班）", [rule]).status).toBe(
      "matched",
    );
  });

  it("不做模糊匹配", () => {
    expect(matchMajorRule("计算机", rules).status).toBe("unmatched");
    expect(matchMajorRule("计算机科学与技术（实验班）", rules).status).toBe(
      "unmatched",
    );
    expect(matchMajorRule("", rules).status).toBe("unmatched");
  });

  it("多条规则命中同一专业时按冲突降级", () => {
    const conflict = [
      makeRule({ ruleId: "a" }),
      makeRule({ ruleId: "b" }),
    ];
    expect(matchMajorRule("计算机科学与技术", conflict)).toEqual({
      status: "conflict",
      ruleIds: ["a", "b"],
    });
  });
});

describe("computeRuleProgress", () => {
  it("汇总总学分与通识学分进度", () => {
    const rule = makeRule();
    const grades = [
      makeGrade({ credits: 100 }),
      makeGrade({ credits: 60, courseCategory: "人文社科" }),
      makeGrade({ credits: 4, courseCategory: "自然科学" }),
    ];
    const progress = computeRuleProgress(rule, grades);
    expect(progress.totalEarned).toBe(164);
    expect(progress.totalRatio).toBeCloseTo(164 / 160);
    expect(progress.generalEarned).toBe(64);
    expect(progress.generalRatio).toBeCloseTo(64 / 12);
  });

  it("限定通识类别时只统计登记的类别", () => {
    const rule = makeRule({ generalEducationCategories: ["人文社科"] });
    const grades = [
      makeGrade({ credits: 2, courseCategory: "人文社科" }),
      makeGrade({ credits: 3, courseCategory: "自然科学" }),
      makeGrade({ credits: 5 }),
    ];
    expect(computeRuleProgress(rule, grades).generalEarned).toBe(2);
  });

  it("通识要求为 0 时进度视为已满", () => {
    const rule = makeRule({ generalEducationCreditsRequired: 0 });
    expect(computeRuleProgress(rule, []).generalRatio).toBe(1);
  });
});

describe("生产规则表", () => {
  it("每条已发布规则都通过 schema 校验", () => {
    for (const rule of MAJOR_RULES) {
      expect(majorRuleSchema.safeParse(rule).success).toBe(true);
    }
  });
});
