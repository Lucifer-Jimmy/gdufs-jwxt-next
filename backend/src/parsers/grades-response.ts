import { DomainError } from "../errors/domain-error";
import { gradeSchema, type Grade } from "../schemas/api";
import { z } from "zod";

const MAX_GRADES = 300;

export interface GradesResponse {
  grades: Grade[];
  reachedPageLimit: boolean;
}

const upstreamGradeSchema = z
  .object({
    kch: z.string().trim().min(1).max(64),
    kc_mc: z.string().trim().min(1).max(256),
    xnxqid: z.string().trim().min(1).max(64),
    xf: z.number().nonnegative(),
    zcj: z.number().min(0).max(100),
    zcjstr: z.string().trim().min(1).max(64),
    jd: z.number().nonnegative(),
    ksfs: z.string().trim().min(1).max(128),
    kcsx: z.string().trim().min(1).max(128),
    txklb: z.string().trim().min(1).max(128).optional(),
    xs0101id: z.string().trim().min(1).max(128),
    jx0404id: z.string().trim().min(1).max(128),
    cj0708id: z.string().trim().min(1).max(128),
  })
  .passthrough();

/**
 * Parse the JSON boundary exposed by cjcx_list. Unknown upstream properties
 * are deliberately ignored so they cannot become part of the public API.
 */
export async function parseGradesResponse(
  response: Response,
): Promise<GradesResponse> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw sessionExpired();
  }

  if (!isRecord(parsed)) {
    throw upstreamChanged();
  }
  if (typeof parsed.code !== "number" || !Number.isFinite(parsed.code)) {
    throw upstreamChanged();
  }
  if (parsed.code !== 0) {
    throw new DomainError({
      code: "UPSTREAM_FAILURE",
      message: "学校系统暂时无法返回成绩，请稍后重试",
      status: 502,
    });
  }
  if (!Array.isArray(parsed.data) || parsed.data.length > MAX_GRADES) {
    throw upstreamChanged();
  }

  const grades: Grade[] = [];
  for (const record of parsed.data) {
    const upstream = upstreamGradeSchema.safeParse(record);
    if (!upstream.success) {
      throw upstreamChanged();
    }
    const value = upstream.data;
    const grade = gradeSchema.safeParse({
      courseCode: value.kch,
      courseName: value.kc_mc,
      semester: value.xnxqid,
      credits: value.xf,
      score: value.zcjstr,
      numericScore: value.zcj,
      gradePoint: value.jd,
      assessmentMethod: value.ksfs,
      courseAttribute: value.kcsx,
      courseCategory: value.txklb ?? null,
      detailKey: {
        studentKey: value.xs0101id,
        teachingClassKey: value.jx0404id,
        gradeRecordKey: value.cj0708id,
        totalScore: value.zcjstr,
      },
    });
    if (!grade.success) {
      throw upstreamChanged();
    }
    grades.push(grade.data);
  }

  return { grades, reachedPageLimit: grades.length >= MAX_GRADES };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionExpired(): DomainError {
  return new DomainError({
    code: "SESSION_EXPIRED",
    message: "登录已失效，请重新登录",
    status: 401,
  });
}

function upstreamChanged(): DomainError {
  return new DomainError({
    code: "UPSTREAM_CHANGED",
    message: "教务系统成绩数据结构发生变化，暂时无法读取成绩",
    status: 502,
  });
}
