import { z } from "zod";

import type { Grade } from "./api";
import { earnedCredits } from "./academics";

/**
 * 专业学分规则框架。
 *
 * 每条规则必须可追溯到学校发布的培养方案或用户确认资料；
 * 未匹配、匹配冲突或字段不完整时一律安全降级，
 * 不得回退到全校统一默认值，也不得展示可能错误的「已达毕业要求」。
 */

export const majorRuleSchema = z
  .object({
    /** 稳定规则 ID，版本化追踪。 */
    ruleId: z.string().min(1),
    /** 标准化专业匹配值（与上游 major 规范化后精确相等）。 */
    majors: z.array(z.string().min(1)).min(1),
    /** 明确登记的别名，同样只参与精确匹配。 */
    aliases: z.array(z.string().min(1)).default([]),
    /** 规则版本，随培养方案调整递增。 */
    version: z.string().min(1),
    /** 预留扩展维度：适用年级或培养方案版本；undefined 表示不限。 */
    enrollmentYears: z.array(z.number().int()).optional(),
    /** 毕业总学分要求。 */
    totalCreditsRequired: z.number().positive(),
    /** 通识学分要求。 */
    generalEducationCreditsRequired: z.number().nonnegative(),
    /**
     * 计入通识学分的课程类别；undefined 表示所有通识类别
     * （上游 courseCategory 非空）均计入。
     */
    generalEducationCategories: z.array(z.string().min(1)).optional(),
    /** 规则来源，必须可追溯。 */
    source: z.object({
      title: z.string().min(1),
      checkedAt: z.iso.date(),
      url: z.string().optional(),
    }),
  })
  .strict();

export type MajorRule = z.infer<typeof majorRuleSchema>;

export type RuleMatch =
  | { status: "matched"; rule: MajorRule }
  | { status: "unmatched" }
  | { status: "conflict"; ruleIds: string[] };

/**
 * 专业名称规范化：去首尾空白、统一全/半角括号、移除所有内部空白。
 * 规范化只服务精确匹配，不做任何模糊或包含匹配。
 */
export function normalizeMajorName(name: string): string {
  return name
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
}

export function matchMajorRule(
  major: string,
  rules: readonly MajorRule[],
): RuleMatch {
  const target = normalizeMajorName(major);
  const matched = rules.filter((rule) =>
    [...rule.majors, ...rule.aliases].some(
      (candidate) => normalizeMajorName(candidate) === target,
    ),
  );
  if (matched.length === 0) {
    return { status: "unmatched" };
  }
  if (matched.length > 1) {
    return {
      status: "conflict",
      ruleIds: matched.map((rule) => rule.ruleId),
    };
  }
  const [rule] = matched;
  return rule === undefined
    ? { status: "unmatched" }
    : { status: "matched", rule };
}

export interface RuleProgress {
  totalEarned: number;
  totalRequired: number;
  /** 0–1，可超过 1（超出要求）。 */
  totalRatio: number;
  generalEarned: number;
  generalRequired: number;
  generalRatio: number;
}

export function computeRuleProgress(
  rule: MajorRule,
  grades: readonly Grade[],
): RuleProgress {
  const totalEarned = earnedCredits(grades);
  const generalEarned = grades
    .filter(
      (grade) =>
        grade.courseCategory !== null &&
        (rule.generalEducationCategories === undefined ||
          rule.generalEducationCategories.includes(grade.courseCategory)),
    )
    .reduce((sum, grade) => sum + grade.credits, 0);
  return {
    totalEarned,
    totalRequired: rule.totalCreditsRequired,
    totalRatio: totalEarned / rule.totalCreditsRequired,
    generalEarned,
    generalRequired: rule.generalEducationCreditsRequired,
    generalRatio:
      rule.generalEducationCreditsRequired === 0
        ? 1
        : generalEarned / rule.generalEducationCreditsRequired,
  };
}
