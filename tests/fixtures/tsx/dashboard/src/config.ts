export function apiBase(): string {
  return import.meta.env?.VITE_API ?? "/api";
}
