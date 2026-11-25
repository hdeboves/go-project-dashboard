export type ToastType = "success" | "error" | "info";

export interface ToastDetail {
  id: string;
  text: string;
  type: ToastType;
}

export function showToast(text: string, type: ToastType = "success") {
  if (typeof window === "undefined") return;
  const detail: ToastDetail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    type,
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>("go:toast", { detail }));
}
