// Options for the active_org preference cookie. The value is only the org id
// plain /app should open; it grants nothing by itself (see
// resolveDefaultMembership). The company being worked in comes from the URL.
export const activeOrgCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};
