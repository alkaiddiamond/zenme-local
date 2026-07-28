import { Suspense } from "react";

import { CanvasRoute } from "@/components/zenme/canvas-route";

export default function ProjectCanvasPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">加载画布...</div>}>
      <CanvasRoute />
    </Suspense>
  );
}
