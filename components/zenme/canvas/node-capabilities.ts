import type { CanvasNodeData } from "@/components/zenme/node-types";
import type { ExecutionKind } from "@/lib/execution/types";

export type CanvasPortDataType = "text" | "image" | "video" | "file";

export type CanvasPortCapability = {
  id: string;
  accepts: CanvasPortDataType[];
  multiple?: boolean;
  required?: boolean;
};

export type CanvasNodeCapability = {
  executable: boolean;
  executionKind?: ExecutionKind;
  inputs: CanvasPortCapability[];
  outputs: CanvasPortCapability[];
};

const TEXT_OUTPUT: CanvasPortCapability = { id: "text", accepts: ["text"] };
const IMAGE_OUTPUT: CanvasPortCapability = { id: "image", accepts: ["image"] };
const VIDEO_OUTPUT: CanvasPortCapability = { id: "video", accepts: ["video"] };
const CONTEXT_INPUT: CanvasPortCapability = {
  id: "context",
  accepts: ["text"],
  multiple: true,
};
const IMAGE_REFERENCE_INPUT: CanvasPortCapability = {
  id: "image-reference",
  accepts: ["image"],
  multiple: true,
};

const NODE_CAPABILITIES: Partial<
  Record<CanvasNodeData["kind"], CanvasNodeCapability>
> = {
  text: {
    executable: true,
    executionKind: "text",
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  textGeneration: {
    executable: true,
    executionKind: "text",
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  agent: {
    executable: true,
    executionKind: "text",
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  code: {
    executable: false,
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  managedText: {
    executable: false,
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  markdown: {
    executable: false,
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  note: {
    executable: false,
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  task: {
    executable: false,
    inputs: [CONTEXT_INPUT],
    outputs: [TEXT_OUTPUT],
  },
  lyrics: {
    executable: false,
    inputs: [],
    outputs: [TEXT_OUTPUT],
  },
  imageGeneration: {
    executable: true,
    executionKind: "image",
    inputs: [CONTEXT_INPUT, IMAGE_REFERENCE_INPUT],
    outputs: [IMAGE_OUTPUT],
  },
  videoGeneration: {
    executable: true,
    executionKind: "video",
    inputs: [CONTEXT_INPUT, IMAGE_REFERENCE_INPUT],
    outputs: [VIDEO_OUTPUT],
  },
  image: {
    executable: true,
    executionKind: "image",
    inputs: [CONTEXT_INPUT, IMAGE_REFERENCE_INPUT],
    outputs: [IMAGE_OUTPUT],
  },
  video: {
    executable: false,
    inputs: [],
    outputs: [VIDEO_OUTPUT],
  },
};

const EMPTY_CAPABILITY: CanvasNodeCapability = {
  executable: false,
  inputs: [],
  outputs: [],
};

export function getCanvasNodeCapability(kind: CanvasNodeData["kind"]) {
  return NODE_CAPABILITIES[kind] ?? EMPTY_CAPABILITY;
}

export function isExecutableCanvasNodeKind(kind: CanvasNodeData["kind"]) {
  return getCanvasNodeCapability(kind).executable;
}

export function acceptsCanvasContext(kind: CanvasNodeData["kind"]) {
  return getCanvasNodeCapability(kind).inputs.some((port) => port.id === "context");
}

export function canConnectCanvasNodeKinds(input: {
  sourceKind: CanvasNodeData["kind"];
  targetKind: CanvasNodeData["kind"];
}) {
  const sourceTypes = getCanvasNodeCapability(input.sourceKind).outputs.flatMap(
    (port) => port.accepts,
  );
  const targetTypes = getCanvasNodeCapability(input.targetKind).inputs.flatMap(
    (port) => port.accepts,
  );
  if (sourceTypes.length === 0 || targetTypes.length === 0) return true;
  return sourceTypes.some((type) => targetTypes.includes(type));
}
