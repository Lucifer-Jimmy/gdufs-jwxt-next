import { DomainError } from "../errors/domain-error";
import { isAllowedUpstreamUrl, UPSTREAM_USER_AGENT } from "./constants";
import { UpstreamCookieJar } from "./cookie-jar";

export type UpstreamFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface UpstreamClientOptions {
  fetcher?: UpstreamFetch;
  timeoutMs: number;
  maxRedirects?: number;
  jar?: UpstreamCookieJar;
  now?: () => number;
}

export class UpstreamClient {
  readonly jar: UpstreamCookieJar;
  private readonly fetcher: UpstreamFetch;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly now: () => number;

  constructor(options: UpstreamClientOptions) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.jar = options.jar ?? new UpstreamCookieJar();
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async request(url: URL, init: RequestInit = {}): Promise<Response> {
    return this.requestInternal(url, init, true);
  }

  async requestManual(url: URL, init: RequestInit = {}): Promise<Response> {
    return this.requestInternal(url, init, false);
  }

  private async requestInternal(
    url: URL,
    init: RequestInit,
    followRedirects: boolean,
  ): Promise<Response> {
    assertAllowedUrl(url);
    let currentUrl = new URL(url);
    let method = init.method?.toUpperCase() ?? "GET";
    let body = init.body;

    for (let redirects = 0; redirects <= this.maxRedirects; redirects += 1) {
      const headers = new Headers(init.headers);
      headers.set("User-Agent", UPSTREAM_USER_AGENT);
      const cookie = this.jar.header(currentUrl, this.now());
      if (cookie !== undefined) {
        headers.set("Cookie", cookie);
      }

      const requestInit: RequestInit = {
        ...init,
        method,
        headers,
        redirect: "manual",
        ...(body === undefined ? {} : { body }),
      };
      const response = await this.fetchOnce(currentUrl, requestInit);
      this.jar.capture(response, currentUrl, this.now());

      if (!isRedirect(response.status) || !followRedirects) {
        return response;
      }
      const location = response.headers.get("Location");
      if (location === null || redirects === this.maxRedirects) {
        throw upstreamFailure("学校系统返回了无效的重定向");
      }
      const redirectedUrl = new URL(location, currentUrl);
      assertAllowedUrl(redirectedUrl);

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = undefined;
      }
      currentUrl = redirectedUrl;
    }

    throw upstreamFailure("学校系统重定向次数过多");
  }

  private async fetchOnce(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DomainError({
          code: "UPSTREAM_TIMEOUT",
          message: "连接学校系统超时，请稍后重试",
          status: 504,
        });
      }
      throw upstreamFailure("连接学校系统失败，请稍后重试");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function assertAllowedUrl(url: URL): void {
  if (!isAllowedUpstreamUrl(url)) {
    throw upstreamFailure("学校系统返回了不受信任的地址");
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function upstreamFailure(message: string): DomainError {
  return new DomainError({ code: "UPSTREAM_FAILURE", message, status: 502 });
}
