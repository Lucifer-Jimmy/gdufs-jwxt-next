import type { Plugin } from "vite";

/**
 * 开发用假接口：仅在 `vite --mode mock` 下启用，拦截 /api/v1/* 返回稳定
 * 测试数据，让前端无需登录、无需后端即可浏览所有页面并联通完整流程。
 *
 * 数据形状与 src/lib/api.ts 的 zod schema 严格对应——任何字段缺失都会在
 * 页面上触发「响应格式已变化」错误，等同一次轻量的前端契约校验。
 * 该文件位于 src 之外，不会进入生产构建。
 */

interface MockGrade {
  courseCode: string;
  courseName: string;
  semester: string;
  credits: number;
  score: string;
  numericScore: number;
  gradePoint: number;
  assessmentMethod: string;
  courseAttribute: string;
  courseCategory: string | null;
  detailKey: {
    studentKey: string;
    teachingClassKey: string;
    gradeRecordKey: string;
    totalScore: string;
  };
}

let recordSeq = 0;

function grade(
  courseName: string,
  semester: string,
  credits: number,
  numericScore: number,
  gradePoint: number,
  attribute: string,
  category: string | null,
  assessmentMethod = "考试",
): MockGrade {
  recordSeq += 1;
  return {
    courseCode: `COURSE${recordSeq.toString().padStart(4, "0")}`,
    courseName,
    semester,
    credits,
    score: String(numericScore),
    numericScore,
    gradePoint,
    assessmentMethod,
    courseAttribute: attribute,
    courseCategory: category,
    detailKey: {
      studentKey: "student-mock",
      teachingClassKey: `class-${recordSeq}`,
      gradeRecordKey: `record-${recordSeq}`,
      totalScore: String(numericScore),
    },
  };
}

// 四个学期、多种课程属性与类别，含一门不及格课程，覆盖 GPA 加权、
// 分学期趋势、学期/属性筛选、通识学分统计等所有前端计算分支。
const GRADES: MockGrade[] = [
  grade("综合英语（一）", "2022-2023-1", 4, 88, 3.7, "必修", null),
  grade("英语语音", "2022-2023-1", 2, 92, 4.0, "必修", null),
  grade("中国近现代史纲要", "2022-2023-1", 3, 79, 2.7, "必修", "思想政治"),
  grade("大学体育（一）", "2022-2023-1", 1, 85, 3.3, "必修", null, "考查"),
  grade("综合英语（二）", "2022-2023-2", 4, 90, 4.0, "必修", null),
  grade("英语听力", "2022-2023-2", 2, 95, 4.0, "必修", null),
  grade("计算机应用基础", "2022-2023-2", 3, 55, 0.0, "选修", "自然科学"),
  grade("跨文化交际导论", "2022-2023-2", 2, 82, 3.0, "选修", "人文社科"),
  grade("高级英语（一）", "2023-2024-1", 4, 87, 3.7, "必修", null),
  grade("英语写作", "2023-2024-1", 2, 91, 4.0, "限选", null),
  grade("语言学导论", "2023-2024-1", 3, 78, 2.7, "限选", null),
  grade("西方文化概论", "2023-2024-1", 2, 96, 4.0, "选修", "人文社科"),
  grade("高级英语（二）", "2023-2024-2", 4, 93, 4.0, "必修", null),
  grade("英汉笔译", "2023-2024-2", 3, 89, 3.7, "必修", null),
  grade("创新创业基础", "2023-2024-2", 2, 84, 3.3, "选修", "创新创业"),
];

const PERSON = {
  studentId: "20220001",
  name: "测试学生",
  college: "英语语言文化学院",
  major: "英语",
};

function futureIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

/** 成绩详情：上游透传的单层 JSON，键名保持教务系统风格。 */
function detailFor(): Record<string, unknown> {
  return {
    平时成绩: "90",
    期中成绩: "85",
    期末成绩: "88",
    总评成绩: "88",
    补考成绩: null,
  };
}

type Responder = () => unknown;

// 路径 → 响应体。写接口与读接口共用同一张表，开发态不区分方法。
const ROUTES: Record<string, Responder> = {
  "/me": () => PERSON,
  "/grades": () => ({ grades: GRADES, reachedPageLimit: false }),
  "/grades/refresh": () => ({
    grades: GRADES,
    reachedPageLimit: false,
    retryAfterSeconds: 30,
  }),
  "/grades/detail": () => detailFor(),
  "/auth/login": () => ({
    maskedPhone: "138****0000",
    mfaExpiresAt: futureIso(10),
  }),
  "/auth/mfa": () => ({
    maskedPhone: "138****0000",
    codeSent: false,
    retryAfterSeconds: 0,
    expiresAt: futureIso(10),
  }),
  "/auth/mfa/send": () => ({ message: "验证码已发送（开发模拟）", retryAfterSeconds: 60 }),
  "/auth/mfa/verify": () => ({ authenticated: true }),
  "/auth/logout": () => ({ loggedOut: true }),
};

const API_PREFIX = "/api/v1";

export function mockApiPlugin(): Plugin {
  return {
    name: "gdufs-dev-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // @types/node 未安装，req 的 url 走轻量断言获取。
        const rawUrl = (req as { url?: string }).url ?? "";
        if (!rawUrl.startsWith(API_PREFIX)) {
          next();
          return;
        }
        // 去掉查询串与前缀，得到形如 "/grades" 的子路径。
        const path = rawUrl.slice(API_PREFIX.length).split("?")[0] ?? "";
        const responder = ROUTES[path];
        if (!responder) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                code: "NOT_FOUND",
                message: `mock 未定义该接口：${path}`,
                requestId: "mock",
              },
            }),
          );
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("X-Request-Id", "mock");
        res.end(JSON.stringify(responder()));
      });
    },
  };
}

