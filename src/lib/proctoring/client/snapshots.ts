"use client";

import { PROCTORING_BUCKET, SNAPSHOT_MAX_EDGE, SNAPSHOT_QUALITY, type SnapshotSource } from "../config";

/**
 * One snapshot: grab a frame from the stream, ask our API for a signed upload
 * URL, upload the JPEG straight to storage (never through our API), then tell
 * the API it's there. Best effort: a failed snapshot is skipped, the next one
 * is taken on schedule.
 */

const players = new WeakMap<MediaStream, HTMLVideoElement>();

async function playerFor(stream: MediaStream): Promise<HTMLVideoElement> {
  let video = players.get(stream);
  if (!video) {
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    players.set(stream, video);
  }
  if (video.readyState < 2) {
    await video.play().catch(() => {});
    await new Promise<void>((resolve) => {
      if (video!.readyState >= 2) return resolve();
      const done = () => resolve();
      video!.addEventListener("loadeddata", done, { once: true });
      setTimeout(done, 3_000);
    });
  }
  return video;
}

export async function captureFrame(stream: MediaStream): Promise<Blob | null> {
  const video = await playerFor(stream);
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", SNAPSHOT_QUALITY));
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function takeSnapshot(source: SnapshotSource, stream: MediaStream): Promise<boolean> {
  try {
    const blob = await captureFrame(stream);
    if (!blob) return false;
    const res = await post("/api/candidate/proctoring/upload", { source });
    if (!res.ok) return false;
    const { path, token } = (await res.json()) as { path: string; token: string };

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const upload = await fetch(`${base}/storage/v1/object/upload/sign/${PROCTORING_BUCKET}/${encoded}?token=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { apikey: key, "content-type": "image/jpeg", "x-upsert": "false" },
      body: blob,
    });
    if (!upload.ok) return false;
    return (await post("/api/candidate/proctoring/media", { path })).ok;
  } catch {
    return false;
  }
}
