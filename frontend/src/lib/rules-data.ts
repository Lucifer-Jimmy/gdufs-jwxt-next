import type { MajorRule } from "./rules";

/**
 * 已验证专业规则表。
 *
 * 录入任何规则前必须具备：学校发布的培养方案来源、毕业总学分、
 * 通识学分要求、课程分类条件与核对日期，并通过匹配与降级测试。
 *
 * 当前没有任何专业完成来源核验，规则表为空——
 * 所有专业在界面上显示安全降级提示，不展示毕业/通识完成比例。
 */
export const MAJOR_RULES: readonly MajorRule[] = [];
