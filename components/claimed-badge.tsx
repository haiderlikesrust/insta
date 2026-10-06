import { BadgeCheck } from "lucide-react";
export function ClaimedBadge({ claimedAt }: { claimedAt?: number | null }) {
  if (!claimedAt) return null;
  return <span className="claimed-badge" title="The creator has verified ownership of the linked Instagram account. This does not indicate a fee withdrawal or endorsement." aria-label="Claimed: creator account ownership verified"><BadgeCheck size={14} aria-hidden="true"/>Claimed</span>;
}
