import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { candidateFirstName, fillTemplate, templateValues, FIRST_NAME_FALLBACK } = await import(
  "@/lib/engine/server/template"
);

describe("candidate first name", () => {
  it("is the first word of the name the candidate gave", () => {
    expect(candidateFirstName("Priya Raman")).toBe("Priya");
    expect(candidateFirstName("  Ana   María López ")).toBe("Ana");
    expect(candidateFirstName("Cher")).toBe("Cher");
  });

  it("falls back to 'there' when there is no name", () => {
    for (const name of [null, undefined, "", "   "]) expect(candidateFirstName(name)).toBe(FIRST_NAME_FALLBACK);
    expect(fillTemplate("Hi {{first_name}},", templateValues({}))).toBe("Hi there,");
  });

  it("caps a very long first word", () => {
    expect(candidateFirstName("x".repeat(500))).toHaveLength(40);
  });

  it("is filled alongside variant values", () => {
    const values = templateValues({ amt: 12_345 }, { name: "Priya Raman" });
    expect(fillTemplate("Hi {{first_name}}, {{amt|money}} is due.", values)).toBe("Hi Priya, $123.45 is due.");
  });

  it("is inserted as text, never re-read as a template", () => {
    const values = templateValues({ secret: 1 }, { name: "{{secret}}" });
    expect(fillTemplate("Hi {{first_name}}", values)).toBe("Hi {{secret}}");
  });

  it("can't be shadowed by a generator value", () => {
    expect(() => templateValues({ first_name: "Dana" }, { name: "Priya" })).toThrow(/reserved/);
  });
});
