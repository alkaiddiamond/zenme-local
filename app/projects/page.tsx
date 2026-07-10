import { AppShell } from "@/components/zenme/app-shell";
import { ProjectsClient } from "@/components/zenme/projects-client";

export default function ProjectsPage() {
  return (
    <AppShell active="projects">
      <ProjectsClient />
    </AppShell>
  );
}
