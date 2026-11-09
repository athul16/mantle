export type UiRole = "admin" | "recruiter" | "viewer";

// Labels match docs/03-roles-and-permissions.md.
export const ROLES_FOR_UI: { value: UiRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Billing, teammates, company-wide settings" },
  { value: "recruiter", label: "Recruiter", hint: "Runs hiring rounds: invites, reviews, advances" },
  { value: "viewer", label: "Viewer", hint: "Reads results, adds notes and votes" },
];
