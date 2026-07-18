export const mfaSessionFixture = {
  version: 1,
  purpose: "mfa",
  issuedAt: 1_753_000_000,
  expiresAt: 1_753_000_600,
  flowId: "flow_fixture_01",
  usernameHash: "hmac_fixture_account_digest",
  maskedPhone: "138****0000",
  resendAllowedAt: 1_753_000_060,
  upstreamCookies: [
    {
      name: "JSESSIONID",
      value: "a".repeat(96),
      domain: "authserver.gdufs.edu.cn",
      path: "/authserver",
    },
    {
      name: "route",
      value: "b".repeat(48),
      domain: "authserver.gdufs.edu.cn",
      path: "/",
    },
  ],
};

export const loginSessionFixture = {
  version: 1,
  purpose: "login",
  issuedAt: 1_753_000_000,
  lastActivityAt: 1_753_000_000,
  idleExpiresAt: 1_753_007_200,
  absoluteExpiresAt: 1_753_028_800,
  accountHash: "hmac_fixture_account_digest",
  upstreamCookies: [
    {
      name: "JSESSIONID",
      value: "c".repeat(128),
      domain: "jwxt.gdufs.edu.cn",
      path: "/jsxsd",
    },
    {
      name: "SERVERID",
      value: "d".repeat(96),
      domain: "jwxt.gdufs.edu.cn",
      path: "/",
    },
  ],
};
