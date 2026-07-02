"use client";

/**
 * App-wide toast bus. The QuickCapture component (mounted globally in the
 * layout) owns the single toast surface; any component can push onto it via
 * emitToast — including an optional action button, used for undo on deletes.
 */

export interface AppToast {
  text: string;
  kind?: "success" | "info" | "error";
  action?: { label: string; run: () => void | Promise<void> };
}

export const TOAST_EVENT = "brocco:toast";

export function emitToast(toast: AppToast) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: toast }));
}
