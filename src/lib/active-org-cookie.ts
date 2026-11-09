// Options for the active_org preference cookie. The value is only an org id
// the user picked; it grants nothing by itself (see requireActiveMembership).
export const activeOrgCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};
