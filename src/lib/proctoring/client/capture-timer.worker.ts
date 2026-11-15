/**
 * Timer thread for away captures. Timers in a hidden tab's main thread are
 * throttled (to once a second or once a minute); a dedicated worker's are not.
 * Protocol: { type: "set", id, ms } starts a timer, { type: "clear", id }
 * cancels it; each firing answers { id }.
 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

self.onmessage = (e: MessageEvent<{ type: "set"; id: number; ms: number } | { type: "clear"; id: number }>) => {
  const msg = e.data;
  if (msg.type === "set") {
    timers.set(
      msg.id,
      setTimeout(() => {
        timers.delete(msg.id);
        self.postMessage({ id: msg.id });
      }, msg.ms),
    );
  } else {
    clearTimeout(timers.get(msg.id));
    timers.delete(msg.id);
  }
};

export {};
