import { DomainError } from "../errors/domain-error";
import { parseGradeDetailPage } from "../parsers/grade-detail-page";
import { parseGradesResponse } from "../parsers/grades-response";
import { parsePersonalInfoPage } from "../parsers/personal-info-page";
import type { GradeDetail, GradeDetailKey } from "../schemas/api";
import type { Grade } from "../schemas/api";
import {
  AUTH_ORIGIN,
  JWXT_GRADE_DETAIL_URL,
  JWXT_GRADES_URL,
  JWXT_LOGIN_HANDLER_URL,
  JWXT_PERSONAL_INFO_URL,
  JWXT_SSO_URL,
  isAllowedUpstreamUrl,
} from "../upstream/constants";
import { UpstreamClient, type UpstreamFetch } from "../upstream/client";
import { UpstreamCookieJar, type UpstreamCookie } from "../upstream/cookie-jar";

export interface PersonalInfo {
  studentId: string;
  name: string;
  college: string;
  major: string;
}

export interface GradesResult {
  grades: Grade[];
  reachedPageLimit: boolean;
}

export type TicketExchangeFailureStage =
  | "jwxt_ticket1_location_missing"
  | "jwxt_ticket1_location_invalid"
  | "jwxt_ticket1_protocol_rejected"
  | "jwxt_ticket1_host_rejected"
  | "jwxt_ticket1_path_rejected"
  | "jwxt_ticket1_parameter_missing";

export async function fetchCookiesByTicket(
  ticketUrl: URL,
  timeoutMs: number,
  now: number,
  fetcher?: UpstreamFetch,
  onTicketFailure?: (stage: TicketExchangeFailureStage) => void,
): Promise<UpstreamCookie[]> {
  const client = new UpstreamClient({
    ...(fetcher === undefined ? {} : { fetcher }),
    timeoutMs,
    now: () => now,
  });

  await client.requestManual(ticketUrl, {
    headers: jwxtHeaders(),
  });
  const ssoResponse = await client.requestManual(JWXT_SSO_URL, {
    headers: jwxtHeaders(),
  });
  const ticket1Url = readTrustedTicket1Url(ssoResponse, onTicketFailure);
  await client.requestManual(ticket1Url, {
    headers: jwxtHeaders(),
  });

  const cookies = client.jar.serializeFor(JWXT_PERSONAL_INFO_URL, now);
  if (cookies.length === 0) {
    throw new DomainError({
      code: "AUTHENTICATION_REQUIRED",
      message: "双因素认证已通过，但教务系统登录未完成，请重新登录",
      status: 401,
    });
  }
  return cookies;
}

export async function getPersonalInfo(
  cookies: readonly UpstreamCookie[],
  timeoutMs: number,
  now: number,
  fetcher?: UpstreamFetch,
): Promise<PersonalInfo> {
  const client = new UpstreamClient({
    ...(fetcher === undefined ? {} : { fetcher }),
    timeoutMs,
    now: () => now,
    jar: new UpstreamCookieJar(cookies),
  });
  const response = await client.requestManual(JWXT_PERSONAL_INFO_URL, {
    headers: jwxtHeaders(),
  });
  if (response.status >= 300 && response.status < 400) {
    classifyRedirect(response);
  }

  try {
    const page = await parsePersonalInfoPage(response);
    if (page.kind === "login") {
      throw sessionExpired();
    }
    return {
      studentId: page.studentId,
      name: page.name,
      college: page.college,
      major: page.major,
    };
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError({
      code: "UPSTREAM_CHANGED",
      message: "教务系统页面结构发生变化，暂时无法读取个人信息",
      status: 502,
    });
  }
}

export async function getAllGrades(
  cookies: readonly UpstreamCookie[],
  timeoutMs: number,
  now: number,
  fetcher?: UpstreamFetch,
): Promise<GradesResult> {
  const client = new UpstreamClient({
    ...(fetcher === undefined ? {} : { fetcher }),
    timeoutMs,
    now: () => now,
    jar: new UpstreamCookieJar(cookies),
  });
  const url = new URL(JWXT_GRADES_URL);
  for (const [name, value] of gradeListParameters()) {
    url.searchParams.set(name, value);
  }

  const response = await client.requestManual(url, {
    headers: jwxtHeaders(),
  });
  if (response.status >= 300 && response.status < 400) {
    classifyJwxtRedirect(response, JWXT_GRADES_URL);
  }
  requireSuccessfulStatus(response, "学校系统暂时无法返回成绩");

  return parseGradesResponse(response);
}

export async function getGradeDetail(
  cookies: readonly UpstreamCookie[],
  detailKey: GradeDetailKey,
  timeoutMs: number,
  now: number,
  fetcher?: UpstreamFetch,
): Promise<GradeDetail> {
  const client = new UpstreamClient({
    ...(fetcher === undefined ? {} : { fetcher }),
    timeoutMs,
    now: () => now,
    jar: new UpstreamCookieJar(cookies),
  });
  const url = new URL(JWXT_GRADE_DETAIL_URL);
  url.searchParams.set("xs0101id", detailKey.studentKey);
  url.searchParams.set("jx0404id", detailKey.teachingClassKey);
  url.searchParams.set("cj0708id", detailKey.gradeRecordKey);
  url.searchParams.set("zcj", detailKey.totalScore);

  const response = await client.requestManual(url, {
    headers: jwxtHeaders(),
  });
  if (response.status >= 300 && response.status < 400) {
    classifyJwxtRedirect(response, JWXT_GRADE_DETAIL_URL);
  }
  requireSuccessfulStatus(response, "学校系统暂时无法返回成绩详情");

  return parseGradeDetailPage(response);
}

function readTrustedTicket1Url(
  response: Response,
  onFailure?: (stage: TicketExchangeFailureStage) => void,
): URL {
  const message = "教务系统登录票据交换失败";
  const location = response.headers.get("Location");
  if (location === null) {
    onFailure?.("jwxt_ticket1_location_missing");
    throw new DomainError({
      code: "TICKET_NOT_FOUND",
      message,
      status: 502,
    });
  }

  let url: URL;
  try {
    url = new URL(location, JWXT_SSO_URL);
  } catch {
    onFailure?.("jwxt_ticket1_location_invalid");
    throw new DomainError({ code: "TICKET_NOT_FOUND", message, status: 502 });
  }
  if (url.protocol !== "https:") {
    onFailure?.("jwxt_ticket1_protocol_rejected");
    throw new DomainError({ code: "TICKET_NOT_FOUND", message, status: 502 });
  }
  if (url.hostname !== JWXT_SSO_URL.hostname) {
    onFailure?.("jwxt_ticket1_host_rejected");
    throw new DomainError({ code: "TICKET_NOT_FOUND", message, status: 502 });
  }
  if (url.pathname !== JWXT_LOGIN_HANDLER_URL.pathname) {
    onFailure?.("jwxt_ticket1_path_rejected");
    throw new DomainError({ code: "TICKET_NOT_FOUND", message, status: 502 });
  }
  if (!nonEmptyQueryValue(url, "ticket1")) {
    onFailure?.("jwxt_ticket1_parameter_missing");
    throw new DomainError({ code: "TICKET_NOT_FOUND", message, status: 502 });
  }
  return url;
}

function nonEmptyQueryValue(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value !== null && value.length > 0;
}

function classifyRedirect(response: Response): never {
  const location = response.headers.get("Location");
  if (location === null) {
    throw sessionExpired();
  }
  try {
    const url = new URL(location, JWXT_PERSONAL_INFO_URL);
    if (url.protocol !== "https:" || url.hostname !== JWXT_SSO_URL.hostname) {
      throw new DomainError({
        code: "UPSTREAM_FAILURE",
        message: "学校系统返回了不受信任的地址",
        status: 502,
      });
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw sessionExpired();
  }
  throw sessionExpired();
}

function classifyJwxtRedirect(response: Response, baseUrl: URL): never {
  const location = response.headers.get("Location");
  if (location === null) {
    throw sessionExpired();
  }
  try {
    const url = new URL(location, baseUrl);
    if (!isAllowedUpstreamUrl(url)) {
      throw new DomainError({
        code: "UPSTREAM_FAILURE",
        message: "学校系统返回了不受信任的地址",
        status: 502,
      });
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw sessionExpired();
  }
  throw sessionExpired();
}

function requireSuccessfulStatus(response: Response, message: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }
  throw new DomainError({
    code: "UPSTREAM_FAILURE",
    message,
    status: 502,
  });
}

function sessionExpired(): DomainError {
  return new DomainError({
    code: "SESSION_EXPIRED",
    message: "登录已失效，请重新登录",
    status: 401,
  });
}

function jwxtHeaders(): Headers {
  return new Headers({
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
      "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    Origin: AUTH_ORIGIN,
  });
}

function gradeListParameters(): ReadonlyArray<readonly [string, string]> {
  return [
    ["pageNum", "1"],
    ["pageSize", "300"],
    ["kksj", ""],
    ["kcxz", ""],
    ["kcsx", ""],
    ["kcmc", ""],
    ["xsfs", "all"],
    ["sfxsbcxq", "1"],
  ];
}
