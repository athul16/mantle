/**
 * sendEmail: on a Vercel deployment (production or preview) a missing
 * RESEND_API_KEY or a placeholder EMAIL_FROM is a clear error, never a silent
 * write to .dev-outbox. Locally it still writes to the outbox.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { sendEmail } = await import("@/lib/email");
const { EnvError } = await import("@/lib/env");

const KEY = "re_DO_NOT_LEAK_789";
const FROM = "Acme Assessments <hiring@acme-assess.com>";
const message = { to: "cand@example.test", subject: "Your code", text: "123456" };

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "outbox-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  send.mockReset();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const outboxFiles = () => readdir(path.join(dir, ".dev-outbox")).catch(() => [] as string[]);

describe.each(["production", "preview"])("on Vercel %s", (vercelEnv) => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", vercelEnv));

  it("throws an EnvError naming RESEND_API_KEY and writes nothing", async () => {
    vi.stubEnv("EMAIL_FROM", FROM);
    const err = await sendEmail(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvError);
    expect((err as Error).message).toContain("RESEND_API_KEY");
    expect(await outboxFiles()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("requires EMAIL_FROM", async () => {
    vi.stubEnv("RESEND_API_KEY", KEY);
    const err = await sendEmail(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvError);
    expect((err as InstanceType<typeof EnvError>).variables).toEqual(["EMAIL_FROM"]);
    expect((err as Error).message).not.toContain(KEY);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses the example.com default sender", async () => {
    vi.stubEnv("RESEND_API_KEY", KEY);
    vi.stubEnv("EMAIL_FROM", "Assessment Platform <no-reply@example.com>");
    const err = await sendEmail(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvError);
    expect((err as InstanceType<typeof EnvError>).variables).toEqual(["EMAIL_FROM"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends through Resend from EMAIL_FROM when configured", async () => {
    vi.stubEnv("RESEND_API_KEY", KEY);
    vi.stubEnv("EMAIL_FROM", FROM);
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null });
    await expect(sendEmail(message)).resolves.toEqual({ id: "msg_1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: FROM, to: message.to, subject: message.subject }));
    expect(await outboxFiles()).toEqual([]);
  });
});

describe("locally (no VERCEL_ENV)", () => {
  it("still writes to .dev-outbox without a key, even under next start", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const sent = await sendEmail(message);
    const files = await outboxFiles();
    expect(files).toEqual([sent.id]);
    const saved = JSON.parse(await readFile(path.join(dir, ".dev-outbox", files[0]), "utf8"));
    expect(saved).toMatchObject({ to: message.to, subject: message.subject, text: message.text });
    expect(send).not.toHaveBeenCalled();
  });
});
