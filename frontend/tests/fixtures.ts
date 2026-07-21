import type { Grade } from "../src/lib/api";

let sequence = 0;

/** 结构等价的脱敏成绩记录工厂，字段值均为虚构。 */
export function makeGrade(overrides: Partial<Grade> = {}): Grade {
  sequence += 1;
  const id = sequence;
  return {
    courseCode: `CS${String(id).padStart(4, "0")}`,
    courseName: `示例课程 ${id}`,
    semester: "2023-2024-1",
    credits: 2,
    score: "85",
    numericScore: 85,
    gradePoint: 3.5,
    assessmentMethod: "考试",
    courseAttribute: "必修",
    courseCategory: null,
    detailKey: {
      studentKey: `sk-${id}`,
      teachingClassKey: `tk-${id}`,
      gradeRecordKey: `rk-${id}`,
      totalScore: "85",
    },
    ...overrides,
  };
}
