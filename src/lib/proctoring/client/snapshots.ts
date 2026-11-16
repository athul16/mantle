"use client";

import { PROCTORING_BUCKET, SNAPSHOT_MAX_EDGE, SNAPSHOT_QUALITY, type CaptureReason, type MediaKind, type SnapshotSource } from "../config";

/**
 * One piece of media: ask our API for a signed upload URL, upload the bytes
 * straight to storage (never through our API), then tell the API it's there.
 * A snapshot first grabs a JPEG frame from the stream. Best effort: a failed snapshot is skipped, the next one
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

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws a w×h source scaled to at most SNAPSHOT_MAX_EDGE and encodes it as JPEG. */
async function toJpeg(w: number, h: number, draw: (ctx: Ctx, width: number, height: number) => void): Promise<Blob | null> {
  const scale = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(w, h));
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    draw(ctx, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality: SNAPSHOT_QUALITY });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", SNAPSHOT_QUALITY));
}

type ImageCaptureCtor = new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };

/** ImageCapture.grabFrame() pulls a fresh frame from the track even in a hidden tab, where a <video> may stop painting. */
async function grabFrame(stream: MediaStream): Promise<Blob | null> {
  const Ctor = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  const track = stream.getVideoTracks()[0];
  if (!Ctor || !track || track.readyState !== "live") return null;
  const bitmap = await new Ctor(track).grabFrame();
  try {
    if (!bitmap.width || !bitmap.height) return null;
    return await toJpeg(bitmap.width, bitmap.height, (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h));
  } finally {
    bitmap.close?.();
  }
}

async function videoFrame(stream: MediaStream): Promise<Blob | null> {
  const video = await playerFor(stream);
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  return toJpeg(w, h, (ctx, width, height) => ctx.drawImage(video, 0, 0, width, height));
}

export async function captureFrame(stream: MediaStream): Promise<Blob | null> {
  try {
    const blob = await grabFrame(stream);
    if (blob) return blob;
  } catch {
    // fall back to the <video> path
  }
  return videoFrame(stream);
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Signed-URL upload of one blob (snapshot JPEG or audio clip). Best effort: false on any failure. */
export async function uploadMedia(args: { source: MediaKind; blob: Blob; contentType: string; reason?: CaptureReason }): Promise<boolean> {
  const { source, blob, contentType, reason } = args;
  try {
    const res = await post("/api/candidate/proctoring/upload", { source, reason, contentType });
    if (!res.ok) return false;
    const { path, token } = (await res.json()) as { path: string; token: string };

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const upload = await fetch(`${base}/storage/v1/object/upload/sign/${PROCTORING_BUCKET}/${encoded}?token=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { apikey: key, "content-type": contentType, "x-upsert": "false" },
      body: blob,
    });
    if (!upload.ok) return false;
    return (await post("/api/candidate/proctoring/media", { path, reason })).ok;
  } catch {
    return false;
  }
}

export async function takeSnapshot(source: SnapshotSource, stream: MediaStream, reason: CaptureReason = "interval"): Promise<boolean> {
  try {
    const blob = await captureFrame(stream);
    if (!blob) return false;
    return await uploadMedia({ source, blob, contentType: "image/jpeg", reason });
  } catch {
    return false;
  }
}
