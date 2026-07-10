import { AppShell } from "@/components/zenme/app-shell";
import { DashboardClient } from "@/components/zenme/dashboard-client";

export default function Home() {
  return (
    <AppShell active="home">
      <DashboardClient />
    </AppShell>
  );
}
