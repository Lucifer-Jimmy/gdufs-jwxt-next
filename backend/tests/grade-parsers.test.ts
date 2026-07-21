import { describe, expect, it } from "vitest";

import { parseGradeDetailPage } from "../src/parsers/grade-detail-page";
import { parseGradesResponse } from "../src/parsers/grades-response";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

const gradeRecord = {
  kch: "GW20021",
  kc_mc: "高等数学",
  xnxqid: "2025-2026-1",
  xf: 4,
  zcjstr: "92",
  zcj: 92,
  jd: 4.2,
  ksfs: "考试",
  kcsx: "必修",
  txklb: "自然科学",
  xs0101id: "student-fixture",
  jx0404id: "class-fixture",
  cj0708id: "record-fixture",
};

describe("grades response parser", () => {
  it("maps the production-facing fields and keeps detail identifiers together", async () => {
    await expect(
      parseGradesResponse(jsonResponse({ code: 0, data: [gradeRecord] })),
    ).resolves.toEqual({
      reachedPageLimit: false,
      grades: [
        {
          courseCode: "GW20021",
          courseName: "高等数学",
          semester: "2025-2026-1",
          credits: 4,
          score: "92",
          numericScore: 92,
          gradePoint: 4.2,
          assessmentMethod: "考试",
          courseAttribute: "必修",
          courseCategory: "自然科学",
          detailKey: {
            studentKey: "student-fixture",
            teachingClassKey: "class-fixture",
            gradeRecordKey: "record-fixture",
            totalScore: "92",
          },
        },
      ],
    });
  });

  it("distinguishes an expired HTML response from changed numeric fields", async () => {
    await expect(
      parseGradesResponse(new Response("<html>login</html>")),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });

    await expect(
      parseGradesResponse(
        jsonResponse({
          code: 0,
          data: [
            {
              ...gradeRecord,
              xf: "4",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED" });
  });

  it("rejects changed records and reports the 300-record boundary", async () => {
    await expect(
      parseGradesResponse(jsonResponse({ code: 1, data: [] })),
    ).rejects.toMatchObject({ code: "UPSTREAM_FAILURE" });
    await expect(
      parseGradesResponse(jsonResponse({ code: 0, data: {} })),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED" });
    await expect(
      parseGradesResponse(
        jsonResponse({ code: 0, data: [{ ...gradeRecord, kc_mc: undefined }] }),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED" });

    const fullPage = Array.from({ length: 300 }, (_, index) => ({
      ...gradeRecord,
      kc_mc: `课程${index}`,
    }));
    const result = await parseGradesResponse(
      jsonResponse({ code: 0, data: fullPage }),
    );
    expect(result).toMatchObject({ reachedPageLimit: true });
    expect(result.grades).toHaveLength(300);
  });

  it("rejects a record when any detail identifier is missing", async () => {
    await expect(
      parseGradesResponse(
        jsonResponse({
          code: 0,
          data: [{ ...gradeRecord, cj0708id: undefined }],
        }),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED" });
  });
});

describe("grade detail page parser", () => {
  const detail = `<html><script>
    let arr = [{"cjxm1":66,"zcj":"84","cjxm3":96,"cjxm2":0,
      "cjxm3bl":"60%","cjxm2bl":"0%","cjxm1bl":"40%"}];
  </script></html>`;

  it("extracts only the fixed production script and preserves upstream fields", async () => {
    await expect(parseGradeDetailPage(new Response(detail))).resolves.toEqual({
      cjxm1: 66,
      zcj: "84",
      cjxm3: 96,
      cjxm2: 0,
      cjxm3bl: "60%",
      cjxm2bl: "0%",
      cjxm1bl: "40%",
    });
  });

  it("distinguishes login pages, missing declarations and invalid JSON", async () => {
    await expect(
      parseGradeDetailPage(
        new Response(
          "<html><title>登录</title><form id=loginForm></form></html>",
        ),
      ),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(
      parseGradeDetailPage(
        new Response("<html><script>let other = [];</script></html>"),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED" });
    await expect(
      parseGradeDetailPage(
        new Response('<script>let arr = [{"cjxm1": 66, broken}];</script>'),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_CHANGED" });
  });

  it("preserves the object when fields differ from the observed sample", async () => {
    await expect(
      parseGradeDetailPage(
        new Response(
          `<script>let arr = [{"zcj":"84","cjxm1":66,"newField":{"label":"保留"}}];</script>`,
        ),
      ),
    ).resolves.toEqual({
      zcj: "84",
      cjxm1: 66,
      newField: { label: "保留" },
    });
  });
});
