"use client";

import { useEffect } from "react";
import { releaseMedia } from "@/lib/proctoring/client/media-store";

/** Stops the camera and screen share once the test is over. */
export function ReleaseMedia() {
  useEffect(() => releaseMedia(), []);
  return null;
}
