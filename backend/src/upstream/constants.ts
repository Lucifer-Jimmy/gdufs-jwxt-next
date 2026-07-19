export const AUTH_ORIGIN = "https://authserver.gdufs.edu.cn";
export const JWXT_ORIGIN = "https://jwxt.gdufs.edu.cn";

export const AUTH_LOGIN_URL = new URL(
  "/authserver/login?service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
  AUTH_ORIGIN,
);
export const AUTH_REAUTH_URL = new URL(
  "/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=https%3A%2F%2Fjwxt.gdufs.edu.cn%2Fsso.jsp",
  AUTH_ORIGIN,
);

export const ALLOWED_UPSTREAM_HOSTS = new Set([
  "authserver.gdufs.edu.cn",
  "jwxt.gdufs.edu.cn",
]);

export function isAllowedUpstreamUrl(url: URL): boolean {
  if (url.protocol !== "https:" || !ALLOWED_UPSTREAM_HOSTS.has(url.hostname)) {
    return false;
  }
  if (url.hostname === "authserver.gdufs.edu.cn") {
    return url.pathname.startsWith("/authserver/");
  }
  return url.pathname === "/sso.jsp" || url.pathname.startsWith("/jsxsd/");
}

export const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
