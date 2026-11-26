export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastDetail {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  durationMs?: number;
}

export function showToast(
  message: string,
  type: ToastType = "success",
  options?: { action?: ToastAction; durationMs?: number }
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>("go:toast", {
      detail: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message,
        type,
        action: options?.action,
        durationMs: options?.durationMs,
      },
    })
  );
}
