/** Header company switcher: switches as soon as another company is picked. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formDataOf } from "../helpers";

vi.mock("@/app/app/[orgSlug]/actions", () => ({ switchOrg: vi.fn(async () => {}) }));

const { switchOrg } = await import("@/app/app/[orgSlug]/actions");
const { OrgSwitcher } = await import("@/app/app/[orgSlug]/org-switcher");

const memberships = [
  { orgId: "o1", orgName: "Harbor Lane", orgSlug: "harbor-lane", role: "admin" },
  { orgId: "o2", orgName: "Kestrel Audit", orgSlug: "kestrel-audit", role: "viewer" },
] as unknown as Parameters<typeof OrgSwitcher>[0]["memberships"];

describe("OrgSwitcher", () => {
  it("lists the user's companies with the active one selected", () => {
    render(<OrgSwitcher memberships={memberships} activeOrgId="o2" />);
    const select = screen.getByRole("combobox", { name: "Company" });
    expect(select).toHaveValue("o2");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Harbor Lane", "Kestrel Audit"]);
  });

  it("switches company on change", async () => {
    const user = userEvent.setup();
    render(<OrgSwitcher memberships={memberships} activeOrgId="o1" />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Company" }), "Kestrel Audit");
    await waitFor(() => expect(switchOrg).toHaveBeenCalledTimes(1));
    expect(formDataOf(vi.mocked(switchOrg))).toEqual({ orgId: "o2" });
  });
});
