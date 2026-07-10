import { Suspense } from "react";

import { AppShell } from "@/components/zenme/app-shell";
import { CanvasRoute } from "@/components/zenme/canvas-route";

export default function ProjectCanvasPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">加载画布...</div>}>
      <AppShell active="canvas">
        <CanvasRoute />
      </AppShell>
    </Suspense>
  );
}
