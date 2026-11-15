"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Submit button for the candidate pages' plain form posts (they go to route
 * handlers, so useFormStatus doesn't see them). Once its form submits, the
 * button is disabled and shows `pendingText` until the next page loads, so a
 * slow server can't collect double clicks. Coming back with the browser's Back
 * button (bfcache) re-enables it.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
  disabled = false,
}: {
  children: ReactNode;
  pendingText: string;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = (e: Event) => {
      if (!e.defaultPrevented) setPending(true);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPending(false);
    };
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <button ref={ref} type="submit" disabled={pending || disabled} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
