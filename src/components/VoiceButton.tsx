"use client";
import { Icon } from "./ui";
export function VoiceButton({ leadId, label = "Sprach-Update" }: { leadId: string; label?: string }) {
  return <button type="button" className="btn btn-ghost flex-col gap-1 py-2 text-[11px]" onClick={() => window.dispatchEvent(new CustomEvent("vault:quick-update", { detail: { leadId } }))}>{Icon.mic}{label}</button>;
}
