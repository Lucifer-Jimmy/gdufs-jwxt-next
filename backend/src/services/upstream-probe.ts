const ALLOWED_HOSTS = new Set(["authserver.gdufs.edu.cn", "jwxt.gdufs.edu.cn"]);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const UPSTREAM_PROBE_TARGETS = [
  {
    id: "authserver-login",
    url: "https://authserver.gdufs.edu.cn/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
    checkLoginFields: true,
  },
  {
    id: "jwxt-sso-entry",
    url: "https://jwxt.gdufs.edu.cn/sso.jsp",
    checkLoginFields: false,
  },
] as const;

interface ProbeCookieSummary {
  domain: string | null;
  expiresPresent: boolean;
  httpOnly: boolean;
  maxAgePresent: boolean;
  name: string;
  path: string | null;
  sameSite: string | null;
  secure: boolean;
  valueBytes: number;
}

interface RedirectSummary {
  host: string;
  path: string;
  status: number;
}

interface ProbeTargetResult {
  charset: string | null;
  contentEncoding: string | null;
  contentType: string | null;
  cookies: ProbeCookieSummary[];
  durationMs: number;
  finalHost: string | null;
  finalPath: string | null;
  httpsRequestSucceeded: boolean;
  id: string;
  loginFields: {
    execution: boolean;
    passwordEncryptSalt: boolean;
  } | null;
  networkError: "fetch_failed" | "redirect_rejected" | "timeout" | null;
  reachable: boolean;
  redirects: RedirectSummary[];
  status: number | null;
}

export interface UpstreamProbeResult {
  checkedAt: string;
  targets: ProbeTargetResult[];
}

type ProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface StoredCookie {
  domain: string;
  hostOnly: boolean;
  name: string;
  path: string;
  value: string;
}

export async function runUpstreamProbe(
  fetcher: ProbeFetch = fetch,
): Promise<UpstreamProbeResult> {
  const targets = await Promise.all(
    UPSTREAM_PROBE_TARGETS.map((target) => probeTarget(target, fetcher)),
  );

  return {
    checkedAt: new Date().toISOString(),
    targets,
  };
}

async function probeTarget(
  target: (typeof UPSTREAM_PROBE_TARGETS)[number],
  fetcher: ProbeFetch,
): Promise<ProbeTargetResult> {
  const startedAt = performance.now();
  const redirects: RedirectSummary[] = [];
  const cookieSummaries: ProbeCookieSummary[] = [];
  const cookieJar: StoredCookie[] = [];
  let currentUrl = new URL(target.url);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!isAllowedUrl(currentUrl)) {
      return failedResult(
        target.id,
        startedAt,
        redirects,
        cookieSummaries,
        "redirect_rejected",
      );
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetcher,
        currentUrl,
        requestHeaders(currentUrl, cookieJar),
      );
    } catch (error: unknown) {
      return failedResult(
        target.id,
        startedAt,
        redirects,
        cookieSummaries,
        error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "fetch_failed",
      );
    }

    const setCookies = response.headers.getSetCookie();
    for (const setCookie of setCookies) {
      const parsed = parseSetCookie(setCookie, currentUrl);
      if (parsed !== null) {
        cookieSummaries.push(parsed.summary);
        upsertCookie(cookieJar, parsed.stored);
      }
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("Location");
      if (location === null || redirectCount === MAX_REDIRECTS) {
        return failedResult(
          target.id,
          startedAt,
          redirects,
          cookieSummaries,
          "redirect_rejected",
        );
      }

      const redirectUrl = new URL(location, currentUrl);
      if (!isAllowedUrl(redirectUrl)) {
        return failedResult(
          target.id,
          startedAt,
          redirects,
          cookieSummaries,
          "redirect_rejected",
        );
      }

      redirects.push({
        host: redirectUrl.hostname,
        path: redirectUrl.pathname,
        status: response.status,
      });
      currentUrl = redirectUrl;
      continue;
    }

    const contentType = response.headers.get("Content-Type");
    const loginFields = target.checkLoginFields
      ? await detectLoginFields(response.clone())
      : null;

    return {
      charset: parseCharset(contentType),
      contentEncoding: response.headers.get("Content-Encoding"),
      contentType,
      cookies: cookieSummaries,
      durationMs: Math.round(performance.now() - startedAt),
      finalHost: currentUrl.hostname,
      finalPath: currentUrl.pathname,
      httpsRequestSucceeded: true,
      id: target.id,
      loginFields,
      networkError: null,
      reachable: true,
      redirects,
      status: response.status,
    };
  }

  return failedResult(
    target.id,
    startedAt,
    redirects,
    cookieSummaries,
    "redirect_rejected",
  );
}

async function fetchWithTimeout(
  fetcher: ProbeFetch,
  url: URL,
  headers: Headers,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetcher(url, {
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function requestHeaders(url: URL, cookieJar: StoredCookie[]): Headers {
  const headers = new Headers({
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    "User-Agent": USER_AGENT,
  });
  const cookieHeader = cookieJar
    .filter((cookie) => cookieMatches(cookie, url))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  if (cookieHeader.length > 0) {
    headers.set("Cookie", cookieHeader);
  }

  return headers;
}

function isAllowedUrl(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function parseCharset(contentType: string | null): string | null {
  if (contentType === null) {
    return null;
  }

  const match = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType);
  return match?.[1]?.toLowerCase() ?? null;
}

async function detectLoginFields(response: Response): Promise<{
  execution: boolean;
  passwordEncryptSalt: boolean;
}> {
  const execution = new PresenceHandler();
  const passwordEncryptSalt = new PresenceHandler();

  await new HTMLRewriter()
    .on("input#execution", execution)
    .on("input#pwdEncryptSalt", passwordEncryptSalt)
    .transform(response)
    .arrayBuffer();

  return {
    execution: execution.present,
    passwordEncryptSalt: passwordEncryptSalt.present,
  };
}

class PresenceHandler implements HTMLRewriterElementContentHandlers {
  present = false;

  element(): void {
    this.present = true;
  }
}

function parseSetCookie(
  value: string,
  sourceUrl: URL,
): { stored: StoredCookie; summary: ProbeCookieSummary } | null {
  const segments = value.split(";").map((segment) => segment.trim());
  const pair = segments[0];
  if (pair === undefined) {
    return null;
  }

  const separator = pair.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const name = pair.slice(0, separator);
  const cookieValue = pair.slice(separator + 1);
  const attributes = new Map<string, string | null>();

  for (const segment of segments.slice(1)) {
    const attributeSeparator = segment.indexOf("=");
    const attributeName = (
      attributeSeparator === -1 ? segment : segment.slice(0, attributeSeparator)
    ).toLowerCase();
    const attributeValue =
      attributeSeparator === -1 ? null : segment.slice(attributeSeparator + 1);
    attributes.set(attributeName, attributeValue);
  }

  const domainAttribute = attributes.get("domain") ?? null;
  const domain = (domainAttribute ?? sourceUrl.hostname)
    .replace(/^\./u, "")
    .toLowerCase();
  const path = attributes.get("path") ?? defaultCookiePath(sourceUrl.pathname);

  return {
    stored: {
      domain,
      hostOnly: domainAttribute === null,
      name,
      path,
      value: cookieValue,
    },
    summary: {
      domain: domainAttribute,
      expiresPresent: attributes.has("expires"),
      httpOnly: attributes.has("httponly"),
      maxAgePresent: attributes.has("max-age"),
      name,
      path: attributes.get("path") ?? null,
      sameSite: attributes.get("samesite") ?? null,
      secure: attributes.has("secure"),
      valueBytes: new TextEncoder().encode(cookieValue).byteLength,
    },
  };
}

function defaultCookiePath(pathname: string): string {
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function cookieMatches(cookie: StoredCookie, url: URL): boolean {
  const hostMatches = cookie.hostOnly
    ? url.hostname === cookie.domain
    : url.hostname === cookie.domain ||
      url.hostname.endsWith(`.${cookie.domain}`);
  return hostMatches && url.pathname.startsWith(cookie.path);
}

function upsertCookie(cookieJar: StoredCookie[], cookie: StoredCookie): void {
  const existingIndex = cookieJar.findIndex(
    (candidate) =>
      candidate.name === cookie.name &&
      candidate.domain === cookie.domain &&
      candidate.path === cookie.path,
  );

  if (existingIndex === -1) {
    cookieJar.push(cookie);
  } else {
    cookieJar[existingIndex] = cookie;
  }
}

function failedResult(
  id: string,
  startedAt: number,
  redirects: RedirectSummary[],
  cookies: ProbeCookieSummary[],
  networkError: ProbeTargetResult["networkError"],
): ProbeTargetResult {
  return {
    charset: null,
    contentEncoding: null,
    contentType: null,
    cookies,
    durationMs: Math.round(performance.now() - startedAt),
    finalHost: null,
    finalPath: null,
    httpsRequestSucceeded: false,
    id,
    loginFields: null,
    networkError,
    reachable: false,
    redirects,
    status: null,
  };
}
