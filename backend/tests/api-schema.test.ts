import { describe, expect, it } from "vitest";

import {
  gradeDetailRequestSchema,
  gradeSchema,
  gradesResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  mfaVerifyRequestSchema,
  personalInfoSchema,
} from "../src/schemas/api";

describe("API v1 schemas", () => {
  it("accepts the named resource contracts", () => {
    expect(
      personalInfoSchema.parse({
        studentId: "20210001",
        name: "脱敏姓名",
        college: "信息科学与技术学院",
        major: "软件工程",
      }),
    ).toBeTruthy();
    expect(
      gradesResponseSchema.parse({
        grades: [
          {
            courseCode: "MATH-1",
            courseName: "高等数学",
            semester: "2025-2026-1",
            credits: 4,
            score: "优秀",
            numericScore: null,
            gradePoint: 4.5,
            courseNature: "必修",
            courseAttribute: "专业课",
            detailKey: {
              studentKey: "student-fixture",
              teachingClassKey: "class-fixture",
              gradeRecordKey: "grade-fixture",
              totalScore: "优秀",
            },
          },
        ],
        reachedPageLimit: false,
      }),
    ).toBeTruthy();
  });

  it("bounds credentials, MFA codes and detail identifiers", () => {
    expect(
      loginRequestSchema.safeParse({ username: "", password: "secret" })
        .success,
    ).toBe(false);
    expect(mfaVerifyRequestSchema.safeParse({ code: "12ab" }).success).toBe(
      false,
    );
    expect(
      gradeDetailRequestSchema.safeParse({
        studentKey: "student-fixture",
        teachingClassKey: "class-fixture",
        gradeRecordKey: "grade-fixture",
        totalScore: "x".repeat(65),
      }).success,
    ).toBe(false);
  });

  it("requires timezone-aware ISO timestamps in authentication responses", () => {
    expect(
      loginResponseSchema.safeParse({
        maskedPhone: "138****0000",
        mfaExpiresAt: "2026-07-19T08:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      loginResponseSchema.safeParse({
        maskedPhone: "138****0000",
        mfaExpiresAt: "2026-07-19T16:00:00+08:00",
      }).success,
    ).toBe(true);
    expect(
      loginResponseSchema.safeParse({
        maskedPhone: "138****0000",
        mfaExpiresAt: "2026-07-19T16:00:00",
      }).success,
    ).toBe(false);
  });

  it("rejects non-finite grade numbers without the deprecated finite check", () => {
    const grade = {
      courseCode: null,
      courseName: "高等数学",
      semester: null,
      credits: 4,
      score: "92",
      numericScore: 92,
      gradePoint: 4.2,
      courseNature: null,
      courseAttribute: null,
      detailKey: null,
    };

    expect(
      gradeSchema.safeParse({ ...grade, credits: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
    expect(
      gradeSchema.safeParse({ ...grade, numericScore: Number.NaN }).success,
    ).toBe(false);
    expect(
      gradeSchema.safeParse({ ...grade, gradePoint: Number.NEGATIVE_INFINITY })
        .success,
    ).toBe(false);
  });
});
