export function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function statusClass(status: string): string {
  if (status === "done") return "status-dot status-done";
  if (status === "blocked" || status === "cancelled") return "status-dot status-blocked";
  if (status === "in_progress" || status === "in_review") return "status-dot status-active";
  return "status-dot status-neutral";
}
