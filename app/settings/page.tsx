import { AppShell } from "@/components/zenme/app-shell";
import { SettingsClient } from "@/components/zenme/settings-client";

export default function SettingsPage() {
  return (
    <AppShell active="settings">
      <SettingsClient />
    </AppShell>
  );
}

