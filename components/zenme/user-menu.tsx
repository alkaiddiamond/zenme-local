import Link from "next/link";
import { HardDrive } from "lucide-react";

export function UserMenu() {
  return (
    <Link
      className="flex size-11 items-center justify-center rounded-full bg-white text-[var(--color-text-secondary)] shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--color-surface-container-low)]"
      href="/settings"
      title="本地数据"
    >
      <HardDrive className="size-5" />
    </Link>
  );
}
