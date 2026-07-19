export interface UpstreamCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
  expiresAt?: number;
}

export class UpstreamCookieJar {
  private readonly cookies: UpstreamCookie[];

  constructor(cookies: readonly UpstreamCookie[] = []) {
    this.cookies = cookies.map((cookie) => ({ ...cookie }));
  }

  capture(response: Response, requestUrl: URL, now: number): void {
    for (const header of response.headers.getSetCookie()) {
      const cookie = parseSetCookie(header, requestUrl, now);
      if (cookie === undefined) {
        continue;
      }
      this.remove(cookie.name, cookie.domain, cookie.path);
      if (cookie.expiresAt === undefined || cookie.expiresAt > now) {
        this.cookies.push(cookie);
      }
    }
  }

  header(url: URL, now: number): string | undefined {
    const values = this.cookies
      .filter((cookie) => cookieMatches(cookie, url, now))
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return values.length === 0 ? undefined : values.join("; ");
  }

  serialize(now: number): UpstreamCookie[] {
    return this.cookies
      .filter(
        (cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now,
      )
      .map((cookie) => ({ ...cookie }));
  }

  private remove(name: string, domain: string, path: string): void {
    const index = this.cookies.findIndex(
      (cookie) =>
        cookie.name === name &&
        cookie.domain === domain &&
        cookie.path === path,
    );
    if (index >= 0) {
      this.cookies.splice(index, 1);
    }
  }
}

function parseSetCookie(
  header: string,
  requestUrl: URL,
  now: number,
): UpstreamCookie | undefined {
  const segments = header.split(";");
  const pair = segments.shift()?.trim();
  if (pair === undefined) {
    return undefined;
  }
  const separator = pair.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }

  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1);
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
    return undefined;
  }

  let domain = requestUrl.hostname;
  let hostOnly = true;
  let path = defaultPath(requestUrl.pathname);
  let secure = false;
  let expiresAt: number | undefined;

  for (const rawAttribute of segments) {
    const attribute = rawAttribute.trim();
    const attributeSeparator = attribute.indexOf("=");
    const key = (
      attributeSeparator < 0
        ? attribute
        : attribute.slice(0, attributeSeparator)
    ).toLowerCase();
    const attributeValue =
      attributeSeparator < 0
        ? ""
        : attribute.slice(attributeSeparator + 1).trim();

    if (key === "domain" && attributeValue.length > 0) {
      const candidate = attributeValue.replace(/^\./u, "").toLowerCase();
      if (
        requestUrl.hostname !== candidate &&
        !requestUrl.hostname.endsWith(`.${candidate}`)
      ) {
        return undefined;
      }
      domain = candidate;
      hostOnly = false;
    } else if (key === "path" && attributeValue.startsWith("/")) {
      path = attributeValue;
    } else if (key === "secure") {
      secure = true;
    } else if (key === "max-age" && /^-?\d+$/u.test(attributeValue)) {
      const seconds = Number(attributeValue);
      expiresAt = seconds <= 0 ? now : now + seconds;
    } else if (key === "expires" && expiresAt === undefined) {
      const milliseconds = Date.parse(attributeValue);
      if (Number.isFinite(milliseconds)) {
        expiresAt = Math.floor(milliseconds / 1000);
      }
    }
  }

  return {
    name,
    value,
    domain,
    path,
    hostOnly,
    secure,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function cookieMatches(cookie: UpstreamCookie, url: URL, now: number): boolean {
  const domainMatches = cookie.hostOnly
    ? url.hostname === cookie.domain
    : url.hostname === cookie.domain ||
      url.hostname.endsWith(`.${cookie.domain}`);
  return (
    domainMatches &&
    pathMatches(cookie.path, url.pathname) &&
    (!cookie.secure || url.protocol === "https:") &&
    (cookie.expiresAt === undefined || cookie.expiresAt > now)
  );
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  return (
    requestPath === cookiePath ||
    (requestPath.startsWith(cookiePath) &&
      (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"))
  );
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname === "/") {
    return "/";
  }
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}
