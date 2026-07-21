export const mfaSessionFixture = {
  flowId: "d6a7cbf1-a27a-4f5f-bd0f-a41e447b51b7",
  username: "fixture-account",
  accountHash: "A".repeat(43),
  maskedPhone: "138****0000",
  codeSent: true,
  resendAllowedAt: 1_753_000_060,
  upstreamCookies: [
    {
      name: "JSESSIONID",
      value: "a".repeat(96),
      domain: "authserver.gdufs.edu.cn",
      path: "/authserver",
      hostOnly: true,
      secure: true,
    },
    {
      name: "route",
      value: "b".repeat(48),
      domain: "authserver.gdufs.edu.cn",
      path: "/",
      hostOnly: true,
      secure: true,
    },
  ],
};

export const loginSessionFixture = {
  accountHash: "A".repeat(43),
  upstreamCookies: [
    {
      name: "JSESSIONID",
      value: "c".repeat(128),
      domain: "jwxt.gdufs.edu.cn",
      path: "/jsxsd",
      hostOnly: true,
      secure: true,
    },
    {
      name: "SERVERID",
      value: "d".repeat(96),
      domain: "jwxt.gdufs.edu.cn",
      path: "/",
      hostOnly: true,
      secure: true,
    },
  ],
};
