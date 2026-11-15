import { describe, expect, it, vi } from "vitest";
import { removeCandidateObjects, runRetentionPurge, type PurgeClient } from "@/lib/retention/purge";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const INV_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INV_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INV_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function fakeClient(rpc: Rpc) {
  const remove = vi.fn(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }));
  const from = vi.fn(() => ({ remove }));
  const client = { rpc: vi.fn(rpc), storage: { from } } as unknown as PurgeClient;
  return { client, remove, from, rpc: client.rpc as unknown as ReturnType<typeof vi.fn> };
}

describe("removeCandidateObjects", () => {
  it("removes only paths inside the org's folder, from the proctoring bucket", async () => {
    const { client, remove, from } = fakeClient(async () => ({ data: null, error: null }));
    const n = await removeCandidateObjects(client, ORG_A, [`${ORG_A}/att/camera/1.jpg`, `${ORG_B}/att/camera/2.jpg`, "../escape.jpg"]);
    expect(from).toHaveBeenCalledWith("proctoring");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toEqual([`${ORG_A}/att/camera/1.jpg`]);
    expect(n).toBe(1);
  });

  it("removes in batches of at most 100", async () => {
    const { client, remove } = fakeClient(async () => ({ data: null, error: null }));
    const paths = Array.from({ length: 250 }, (_, i) => `${ORG_A}/att/screen/${i}.jpg`);
    expect(await removeCandidateObjects(client, ORG_A, paths)).toBe(250);
    expect(remove.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
  });

  it("does nothing with no paths", async () => {
    const { client, remove } = fakeClient(async () => ({ data: null, error: null }));
    expect(await removeCandidateObjects(client, ORG_A, [])).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("runRetentionPurge", () => {
  const now = new Date("2026-11-10T03:00:00Z");
  const ATT_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const empty = { checked: 0, purged: 0, failed: 0, objectsRemoved: 0 };

  it("purges media past the media period, then candidates past the results period", async () => {
    const { client, rpc, remove } = fakeClient(async (fn, args) => {
      if (fn === "list_media_past_retention") return { data: [{ attempt_id: ATT_1, org_id: ORG_A }], error: null };
      if (fn === "purge_media_for_retention") return { data: [`${ORG_A}/${ATT_1}/camera/1.jpg`, `${ORG_A}/${ATT_1}/screen/1.jpg`], error: null };
      if (fn === "list_candidates_past_retention") {
        return { data: [{ invite_id: INV_1, org_id: ORG_A }, { invite_id: INV_2, org_id: ORG_B }], error: null };
      }
      if (fn === "purge_candidate_for_retention") {
        const org = args.p_invite_id === INV_1 ? ORG_A : ORG_B;
        return { data: [`${org}/att/camera/1.jpg`], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await runRetentionPurge(client, { now, limit: 50 });

    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "list_media_past_retention",
      "purge_media_for_retention",
      "list_candidates_past_retention",
      "purge_candidate_for_retention",
      "purge_candidate_for_retention",
    ]);
    expect(rpc).toHaveBeenCalledWith("list_media_past_retention", { p_now: now.toISOString(), p_limit: 50 });
    expect(rpc).toHaveBeenCalledWith("purge_media_for_retention", { p_attempt_id: ATT_1, p_now: now.toISOString() });
    expect(rpc).toHaveBeenCalledWith("list_candidates_past_retention", { p_now: now.toISOString(), p_limit: 50 });
    expect(rpc).toHaveBeenCalledWith("purge_candidate_for_retention", { p_invite_id: INV_1, p_now: now.toISOString() });
    expect(rpc).toHaveBeenCalledWith("purge_candidate_for_retention", { p_invite_id: INV_2, p_now: now.toISOString() });
    expect(remove).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      media: { checked: 1, purged: 1, failed: 0, objectsRemoved: 2 },
      results: { checked: 2, purged: 2, failed: 0, objectsRemoved: 2 },
    });
  });

  it("keeps going when one candidate fails, and reports it without PII", async () => {
    const { client } = fakeClient(async (fn, args) => {
      if (fn === "list_media_past_retention") return { data: [], error: null };
      if (fn === "list_candidates_past_retention") {
        return { data: [{ invite_id: INV_1, org_id: ORG_A }, { invite_id: INV_2, org_id: ORG_A }, { invite_id: INV_3, org_id: ORG_A }], error: null };
      }
      if (args.p_invite_id === INV_2) return { data: null, error: { message: "boom" } };
      return { data: [], error: null };
    });
    const result = await runRetentionPurge(client, { now });
    expect(result).toEqual({ media: empty, results: { checked: 3, purged: 2, failed: 1, objectsRemoved: 0 } });
  });

  it("keeps going to the results clock when one media purge fails", async () => {
    const { client } = fakeClient(async (fn) => {
      if (fn === "list_media_past_retention") return { data: [{ attempt_id: ATT_1, org_id: ORG_A }], error: null };
      if (fn === "purge_media_for_retention") return { data: null, error: { message: "boom" } };
      if (fn === "list_candidates_past_retention") return { data: [{ invite_id: INV_1, org_id: ORG_A }], error: null };
      return { data: [], error: null };
    });
    const result = await runRetentionPurge(client, { now });
    expect(result).toEqual({
      media: { checked: 1, purged: 0, failed: 1, objectsRemoved: 0 },
      results: { checked: 1, purged: 1, failed: 0, objectsRemoved: 0 },
    });
  });

  it("throws when a listing itself fails", async () => {
    const { client } = fakeClient(async () => ({ data: null, error: { message: "db down" } }));
    await expect(runRetentionPurge(client, { now })).rejects.toThrow(/db down/);
  });

  it("defaults to a batch of 200 for both clocks", async () => {
    const { client, rpc } = fakeClient(async () => ({ data: [], error: null }));
    await runRetentionPurge(client, { now });
    expect(rpc).toHaveBeenCalledWith("list_media_past_retention", { p_now: now.toISOString(), p_limit: 200 });
    expect(rpc).toHaveBeenCalledWith("list_candidates_past_retention", { p_now: now.toISOString(), p_limit: 200 });
  });
});
