"use client";

import { useParams } from "next/navigation";

import { CanvasClient } from "@/components/zenme/canvas-client";

export function CanvasRoute() {
  const params = useParams<{ id: string }>();

  return <CanvasClient projectId={params.id} />;
}
