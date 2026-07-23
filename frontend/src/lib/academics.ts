import type { Grade } from "./api";

/**
 * 学业计算口径与旧项目生产实现保持一致：
 * - 加权 GPA = Σ(绩点 × 学分) / Σ学分，全部成绩记录计入，
 *   含不及格（绩点为 0 仍进分子，学分仍进分母）；重修/补考按独立记录各自计入。
 * - 已修学分 = 全部成绩记录的学分合计。
 * 数据只存在于当前页面内存，不做任何持久化。
 */

export interface SemesterTrendPoint {
  semester: string;
  shortLabel: string;
  gpa: number;
  credits: number;
  courseCount: number;
}

export type GradeSortKey = "semester" | "credits" | "numericScore" | "gradePoint";
export type SortDirection = "asc" | "desc";

export interface GradeFilter {
  semester: string | null;
  courseAttribute: string | null;
}

/** 加权 GPA；学分为零的记录集合无法计算，返回 null 由界面显示「—」。 */
export function weightedGpa(grades: readonly Grade[]): number | null {
  const totalCredits = grades.reduce((sum, grade) => sum + grade.credits, 0);
  if (totalCredits === 0) {
    return null;
  }
  const weighted = grades.reduce(
    (sum, grade) => sum + grade.gradePoint * grade.credits,
    0,
  );
  return weighted / totalCredits;
}

export function earnedCredits(grades: readonly Grade[]): number {
  return grades.reduce((sum, grade) => sum + grade.credits, 0);
}

/**
 * 是否为不及格记录：绩点为 0 且百分制低于 60。
 * 同时要求 gradePoint===0 可避免把无绩点口径（如“通过/合格”）误判为不及格。
 */
export function isFailingGrade(grade: Grade): boolean {
  return grade.gradePoint === 0 && grade.numericScore < 60;
}

/** 通识课程学分：上游 courseCategory 非空即为通识类课程。 */
export function generalEducationCredits(grades: readonly Grade[]): number {
  return grades
    .filter((grade) => grade.courseCategory !== null)
    .reduce((sum, grade) => sum + grade.credits, 0);
}

const SEMESTER_PATTERN = /^(\d{4})-(\d{4})-(\d)$/;

/** 学期标识排序键；无法解析时返回 null，由调用方回退到字符串比较。 */
function semesterKey(semester: string): [number, number, number] | null {
  const match = SEMESTER_PATTERN.exec(semester);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemesters(a: string, b: string): number {
  const keyA = semesterKey(a);
  const keyB = semesterKey(b);
  if (keyA && keyB) {
    for (let index = 0; index < 3; index += 1) {
      const left = keyA[index] ?? 0;
      const right = keyB[index] ?? 0;
      if (left !== right) {
        return left - right;
      }
    }
    return 0;
  }
  return a.localeCompare(b, "zh-Hans-CN");
}

/** 「2023-2024-1」→「23-24-1」，用于趋势图横轴短标签。 */
export function formatSemesterShort(semester: string): string {
  const match = SEMESTER_PATTERN.exec(semester);
  if (!match) {
    return semester;
  }
  return `${match[1]?.slice(2)}-${match[2]?.slice(2)}-${match[3]}`;
}

/** 出现过的学期，按时间倒序（最新在前）。 */
export function semestersOf(grades: readonly Grade[]): string[] {
  return [...new Set(grades.map((grade) => grade.semester))].sort((a, b) =>
    compareSemesters(b, a),
  );
}

export function currentSemester(grades: readonly Grade[]): string | null {
  return semestersOf(grades)[0] ?? null;
}

/** 分学期 GPA 趋势，按时间正序（最早在前），GPA 保留两位小数。 */
export function semesterTrend(
  grades: readonly Grade[],
): SemesterTrendPoint[] {
  return semestersOf(grades)
    .reverse()
    .map((semester) => {
      const semesterGrades = grades.filter(
        (grade) => grade.semester === semester,
      );
      return {
        semester,
        shortLabel: formatSemesterShort(semester),
        gpa: round2(weightedGpa(semesterGrades) ?? 0),
        credits: earnedCredits(semesterGrades),
        courseCount: semesterGrades.length,
      };
    });
}

export function courseAttributesOf(grades: readonly Grade[]): string[] {
  return [...new Set(grades.map((grade) => grade.courseAttribute))].sort(
    (a, b) => a.localeCompare(b, "zh-Hans-CN"),
  );
}

export function filterGrades(
  grades: readonly Grade[],
  filter: GradeFilter,
): Grade[] {
  return grades.filter(
    (grade) =>
      (filter.semester === null || grade.semester === filter.semester) &&
      (filter.courseAttribute === null ||
        grade.courseAttribute === filter.courseAttribute),
  );
}

/** 默认排序：学期倒序，同学期内保持上游返回顺序（稳定排序）。 */
export function sortGrades(
  grades: readonly Grade[],
  key: GradeSortKey | null,
  direction: SortDirection,
): Grade[] {
  const sign = direction === "asc" ? 1 : -1;
  const sorted = [...grades];
  if (key === null) {
    return sorted.sort(
      (a, b) => compareSemesters(b.semester, a.semester) * 1,
    );
  }
  return sorted.sort((a, b) => {
    if (key === "semester") {
      return compareSemesters(a.semester, b.semester) * sign;
    }
    return (a[key] - b[key]) * sign;
  });
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatGpa(gpa: number | null): string {
  return gpa === null ? "—" : gpa.toFixed(2);
}

export function formatCredits(credits: number): string {
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(1);
}
