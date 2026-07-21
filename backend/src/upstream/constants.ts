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
export const AUTH_MFA_SEND_URL = new URL(
  "/authserver/dynamicCode/getDynamicCodeByReauth.do",
  AUTH_ORIGIN,
);
export const AUTH_MFA_VERIFY_URL = new URL(
  "/authserver/reAuthCheck/reAuthSubmit.do",
  AUTH_ORIGIN,
);

export const JWXT_SSO_URL = new URL("/sso.jsp", JWXT_ORIGIN);
export const JWXT_LOGIN_HANDLER_URL = new URL(
  "/jsxsd/xk/LoginToXk",
  JWXT_ORIGIN,
);
export const JWXT_PERSONAL_INFO_URL = new URL(
  "/jsxsd/framework/xsMainV_new.htmlx?t1=1",
  JWXT_ORIGIN,
);
export const JWXT_GRADES_URL = new URL("/jsxsd/kscj/cjcx_list", JWXT_ORIGIN);
export const JWXT_GRADE_DETAIL_URL = new URL(
  "/jsxsd/kscj/pscj_list.do",
  JWXT_ORIGIN,
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
  return (
    url.pathname === JWXT_SSO_URL.pathname ||
    url.pathname === JWXT_LOGIN_HANDLER_URL.pathname ||
    url.pathname === "/jsxsd/framework/xsMainV_new.htmlx" ||
    url.pathname === "/jsxsd/kscj/cjcx_list" ||
    url.pathname === "/jsxsd/kscj/pscj_list.do"
  );
}

export const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
