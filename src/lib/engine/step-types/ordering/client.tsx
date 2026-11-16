"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { StepComponentProps } from "../../types";
import { orderingAnswerSchemaFor, type OrderingAnswer, type OrderingPublicConfig } from "./public";

type Control = "handle" | "up" | "down";

function moveTo(order: string[], id: string, to: number): string[] {
  const rest = order.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Browser half of the `ordering` step type: a numbered list the candidate
 * reorders. Each row has a drag handle (pointer events, so mouse, pen and
 * touch all work; arrow keys, Home and End move the row while the handle has
 * focus) and Up / Down buttons. Every move saves the whole order and is
 * announced. The prompt is shown by the page (the workspace's brief column).
 */
export function OrderingStep({ config, answer, onChange, disabled }: StepComponentProps<OrderingPublicConfig, OrderingAnswer>) {
  const id = useId();
  const ids = config.items.map((i) => i.id);
  const savedValid = !!answer && orderingAnswerSchemaFor(ids).safeParse(answer).success;
  const [order, setOrderState] = useState<string[]>(() => (savedValid ? answer!.order : ids));
  const [saved, setSaved] = useState(savedValid);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);

  const orderRef = useRef(order);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string; control: Control } | null>(null);
  const drag = useRef<{ id: string; pointerId: number; slots: { top: number; bottom: number }[]; start: string[] } | null>(null);

  const byId = new Map(config.items.map((i) => [i.id, i]));
  const labelOf = (itemId: string) => byId.get(itemId)?.label ?? itemId;
  const n = order.length;
  const helpId = `${id}-help`;

  const setOrder = (next: string[]) => {
    orderRef.current = next;
    setOrderState(next);
  };

  const commit = (next: string[], movedId: string) => {
    setOrder(next);
    setSaved(true);
    setAnnouncement(`"${labelOf(movedId)}" moved to position ${next.indexOf(movedId) + 1} of ${next.length}.`);
    onChange({ order: next });
  };

  const move = (itemId: string, to: number, focus: Control) => {
    const current = orderRef.current;
    const from = current.indexOf(itemId);
    const target = Math.max(0, Math.min(current.length - 1, to));
    if (from === target) return;
    const next = moveTo(current, itemId, target);
    // A button that becomes disabled at the end of the list hands focus to its partner.
    const control: Control = focus === "up" && target === 0 ? "down" : focus === "down" && target === next.length - 1 ? "up" : focus;
    pendingFocus.current = { id: itemId, control };
    commit(next, itemId);
  };

  // Moving a row moves its DOM node, which drops focus; put it back.
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    controls.current.get(`${want.id}:${want.control}`)?.focus();
  }, [order]);

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    if (disabled) return;
    const at = orderRef.current.indexOf(itemId);
    const to = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: orderRef.current.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(itemId, to, "handle");
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, itemId: string) => {
    if (disabled || e.button !== 0) return;
    const slots = orderRef.current.map((x) => {
      const r = rows.current.get(x)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: itemId, pointerId: e.pointerId, slots, start: orderRef.current };
    setDragging(itemId);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const y = e.clientY;
    let to = d.slots.findIndex((s) => y >= s.top && y < s.bottom);
    if (to === -1) to = y < d.slots[0].top ? 0 : d.slots.length - 1;
    if (orderRef.current.indexOf(d.id) !== to) setOrder(moveTo(orderRef.current, d.id, to));
  };

  const endDrag = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(null);
    if (cancelled) return setOrder(d.start);
    const next = orderRef.current;
    if (next.some((x, i) => x !== d.start[i])) commit(next, d.id);
  };

  const ref = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) controls.current.set(key, el);
    else controls.current.delete(key);
  };

  return (
    <section className="card" style={{ maxWidth: 720, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <p id={helpId} className="small muted">
        Put the items in order, first at the top. Drag a row by its handle, or focus the handle and use the arrow keys, or use the Up and
        Down buttons. Your order is saved as you go.
      </p>
      <ol role="list" aria-label="Your order" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {order.map((itemId, index) => {
          const item = byId.get(itemId)!;
          const active = dragging === itemId;
          return (
            <li
              key={itemId}
              data-label={item.label}
              ref={(el) => {
                if (el) rows.current.set(itemId, el);
                else rows.current.delete(itemId);
              }}
              className="row g10"
              style={{
                padding: "6px 8px",
                borderRadius: 7,
                border: `1px solid ${active ? "var(--accent-line)" : "var(--line-2)"}`,
                background: active ? "var(--accent-soft)" : "#fff",
                boxShadow: active ? "0 4px 12px rgba(0,0,0,.08)" : undefined,
              }}
            >
              <button
                type="button"
                ref={ref(`${itemId}:handle`)}
                className="btn btn-ghost btn-icon"
                aria-label={`Reorder "${item.label}", position ${index + 1} of ${n}`}
                aria-describedby={helpId}
                disabled={disabled}
                onKeyDown={(e) => onHandleKey(e, itemId)}
                onPointerDown={(e) => onPointerDown(e, itemId)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endDrag(e, false)}
                onPointerCancel={(e) => endDrag(e, true)}
                style={{ width: 40, height: 40, touchAction: "none", cursor: disabled ? "not-allowed" : active ? "grabbing" : "grab" }}
              >
                <svg className="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="5.5" cy="4" r="1" />
                  <circle cx="10.5" cy="4" r="1" />
                  <circle cx="5.5" cy="8" r="1" />
                  <circle cx="10.5" cy="8" r="1" />
                  <circle cx="5.5" cy="12" r="1" />
                  <circle cx="10.5" cy="12" r="1" />
                </svg>
              </button>
              <span className="strong tnum muted" aria-hidden="true" style={{ minWidth: 20, textAlign: "right" }}>
                {index + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14 }}>{item.label}</span>
                {item.detail ? <span className="xs muted">{item.detail}</span> : null}
              </span>
              <button
                type="button"
                ref={ref(`${itemId}:up`)}
                className="btn btn-sm"
                aria-label={`Move "${item.label}" up`}
                disabled={disabled || index === 0}
                onClick={() => move(itemId, index - 1, "up")}
              >
                Up
              </button>
              <button
                type="button"
                ref={ref(`${itemId}:down`)}
                className="btn btn-sm"
                aria-label={`Move "${item.label}" down`}
                disabled={disabled || index === n - 1}
                onClick={() => move(itemId, index + 1, "down")}
              >
                Down
              </button>
            </li>
          );
        })}
      </ol>
      {!saved ? (
        <div className="row g10">
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => commitAsIs()}>
            Keep this order
          </button>
          <span className="small muted">if it&apos;s already right</span>
        </div>
      ) : null}
      <p role="status" className="sr">
        {announcement}
      </p>
    </section>
  );

  function commitAsIs() {
    setSaved(true);
    setAnnouncement("Order saved.");
    onChange({ order: orderRef.current });
  }
}
