"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

/** The current page's link with a Copy button (phone page, prototype vPhone()). */
export function CopyLink({ display }: { display: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("?")[0]);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="row g8" style={{ padding: "0 6px 0 12px", height: 52, border: "1px solid var(--line-2)", borderRadius: 10, background: "var(--subtle)" }}>
      <span className="small tnum" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {display}
      </span>
      <button type="button" className="btn btn-sm" style={{ height: 40 }} onClick={() => void copy()}>
        <Icon name={copied ? "check" : "copy"} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
