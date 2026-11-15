/** Header account menu: company switcher, account links and sign out. Main nav: the active tab follows the URL. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formDataOf } from "../helpers";

let pathname = "/app/harbor-lane/jobs";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/app/app/[orgSlug]/actions", () => ({ switchOrg: vi.fn(async () => {}) }));
vi.mock("@/app/(auth)/actions", () => ({ signOut: vi.fn(async () => {}) }));

const { switchOrg } = await import("@/app/app/[orgSlug]/actions");
const { AccountMenu, MainNav } = await import("@/app/app/[orgSlug]/org-switcher");

const memberships = [
  { orgId: "o1", orgName: "Harbor Lane", orgSlug: "harbor-lane", role: "admin" },
  { orgId: "o2", orgName: "Kestrel Audit", orgSlug: "kestrel-audit", role: "viewer" },
] as unknown as Parameters<typeof AccountMenu>[0]["memberships"];

function renderMenu(active = memberships[0]) {
  render(<AccountMenu email="maya@example.com" memberships={memberships} active={active} />);
  return userEvent.setup();
}

describe("AccountMenu", () => {
  it("is closed until the account button is pressed", async () => {
    const user = renderMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Harbor Lane/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("lists the user's companies with the active one checked", async () => {
    const user = renderMenu(memberships[1]);
    await user.click(screen.getByRole("button", { name: /Kestrel Audit/ }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    expect(screen.getByRole("menuitemradio", { name: /Kestrel Audit/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /Harbor Lane/ })).toHaveAttribute("aria-checked", "false");
  });

  it("switches company when another one is picked", async () => {
    const user = renderMenu();
    await user.click(screen.getByRole("button", { name: /Harbor Lane/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Kestrel Audit/ }));
    await waitFor(() => expect(switchOrg).toHaveBeenCalledTimes(1));
    expect(formDataOf(vi.mocked(switchOrg))).toEqual({ orgId: "o2" });
  });

  it("links to team, settings and two-factor, and offers sign out", async () => {
    const user = renderMenu();
    await user.click(screen.getByRole("button", { name: /Harbor Lane/ }));
    expect(screen.getByRole("menuitem", { name: "Team" })).toHaveAttribute("href", "/app/harbor-lane/team");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/app/harbor-lane/settings");
    expect(screen.getByRole("menuitem", { name: "Two-factor authentication" })).toHaveAttribute("href", "/app/account/security");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("hides the company list for someone in one company", async () => {
    render(<AccountMenu email="maya@example.com" memberships={[memberships[0]]} active={memberships[0]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Harbor Lane/ }));
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });
});

describe("MainNav", () => {
  it("marks the tab for the current page", () => {
    pathname = "/app/harbor-lane/jobs/assessments";
    render(<MainNav orgSlug="harbor-lane" />);
    expect(screen.getByRole("link", { name: "Assessments" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Jobs" })).not.toHaveAttribute("aria-current");
  });

  it("marks Jobs on a job page", () => {
    pathname = "/app/harbor-lane/jobs/123";
    render(<MainNav orgSlug="harbor-lane" />);
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("aria-current", "page");
  });
});
