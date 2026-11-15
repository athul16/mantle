/** VerifyForm: the emailed code is shown as "123 456"; pasting it in any shape must yield six digits. */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { VerifyForm } from "@/app/a/[token]/verify/verify-form";

function setup() {
  render(
    <VerifyForm
      token="tok"
      defaultName=""
      sentTo="a@b.co"
      resendFormId="resend"
      canResend
      notice={<p>notice</p>}
      consentLabel="I agree"
    />,
  );
  return {
    code: screen.getByLabelText("Code from your email") as HTMLInputElement,
    name: screen.getByLabelText("Full name") as HTMLInputElement,
    consent: screen.getByRole("checkbox"),
    submit: screen.getByRole("button", { name: /Continue/ }),
  };
}

describe("VerifyForm code input", () => {
  it.each([
    ["123 456", "123456"],
    ["123-456", "123456"],
    [" 123456 ", "123456"],
    ["Your code is 123 456", "123456"],
    ["1234567", "123456"],
  ])("pasting %j gives %s", async (pasted, expected) => {
    const user = userEvent.setup();
    const { code } = setup();
    await user.click(code);
    await user.paste(pasted);
    expect(code.value).toBe(expected);
  });

  it("a raw paste event also normalises", () => {
    const { code } = setup();
    fireEvent.paste(code, { clipboardData: { getData: () => "123 456" } });
    expect(code.value).toBe("123456");
  });

  it("typing stops at six digits", async () => {
    const user = userEvent.setup();
    const { code } = setup();
    await user.type(code, "12345678");
    expect(code.value).toBe("123456");
  });

  it("keeps numeric and one-time-code hints", () => {
    const { code } = setup();
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("submit is disabled until name, code and consent are set", async () => {
    const user = userEvent.setup();
    const { code, name, consent, submit } = setup();
    expect(submit).toBeDisabled();
    await user.type(name, "Ada Lovelace");
    await user.click(code);
    await user.paste("123 456");
    expect(submit).toBeDisabled();
    await user.click(consent);
    expect(submit).toBeEnabled();
  });
});
