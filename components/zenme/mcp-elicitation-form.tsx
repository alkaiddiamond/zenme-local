"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

export type McpElicitationView = {
  mode: "form" | "url";
  url?: string;
  requestedSchema?: Record<string, unknown>;
};

export function projectMcpElicitationFromEvent(event: ProjectAgentEvent): McpElicitationView | null {
  const output = event.data?.output;
  if (!isRecordValue(output)) return null;
  const value = output.mcpElicitation;
  if (!isRecordValue(value) || (value.mode !== "form" && value.mode !== "url")) return null;
  return {
    mode: value.mode,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(isRecordValue(value.requestedSchema) ? { requestedSchema: value.requestedSchema } : {}),
  };
}

export function McpElicitationForm({
  disabled,
  onChange,
  schema,
}: {
  disabled: boolean;
  onChange: (serializedContent: string) => void;
  schema?: Record<string, unknown>;
}) {
  const properties = useMemo(() => isRecordValue(schema?.properties) ? schema.properties : {}, [schema]);
  const required = useMemo(() => new Set(Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === "string") : []), [schema]);
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>(() =>
    Object.fromEntries(Object.entries(properties).flatMap(([name, definition]) => {
      if (!isRecordValue(definition)) return [];
      if (definition.default === undefined && definition.type === "boolean") return [[name, false]];
      if (definition.default === undefined) return [];
      const value = definition.default;
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"))
        ? [[name, value]]
        : [];
    })),
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current(serializeMcpElicitationFormValues(schema, values));
  }, [schema, values]);

  function update(name: string, value: string | number | boolean | string[]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      {Object.entries(properties).map(([name, rawDefinition]) => {
        const definition = isRecordValue(rawDefinition) ? rawDefinition : {};
        const label = typeof definition.title === "string" ? definition.title : name;
        const description = typeof definition.description === "string" ? definition.description : "";
        const enumValues = Array.isArray(definition.enum)
          ? definition.enum.filter((item): item is string => typeof item === "string")
          : [];
        const value = values[name];
        return (
          <label className="grid gap-1" key={name}>
            <span className="font-medium text-zinc-700">{label}{required.has(name) ? " *" : ""}</span>
            {enumValues.length ? (
              <select className="h-9 rounded-md border border-zinc-200 bg-white px-2" disabled={disabled} onChange={(changeEvent) => update(name, changeEvent.target.value)} value={typeof value === "string" ? value : ""}>
                <option value="">请选择</option>
                {enumValues.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : definition.type === "boolean" ? (
              <input checked={value === true} disabled={disabled} onChange={(changeEvent) => update(name, changeEvent.target.checked)} type="checkbox" />
            ) : (
              <input className="h-9 rounded-md border border-zinc-200 bg-white px-2" disabled={disabled} onChange={(changeEvent) => update(name, definition.type === "number" || definition.type === "integer" ? Number(changeEvent.target.value) : changeEvent.target.value)} type={definition.type === "number" || definition.type === "integer" ? "number" : "text"} value={typeof value === "string" || typeof value === "number" ? value : ""} />
            )}
            {description ? <span className="text-zinc-400">{description}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

export function serializeMcpElicitationFormValues(
  schema: Record<string, unknown> | undefined,
  values: Record<string, string | number | boolean | string[]>,
) {
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  const valid = required.every((name) => {
    if (!(name in values)) return false;
    const value = values[name];
    if (typeof value === "string" || Array.isArray(value)) return value.length > 0;
    return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
  });
  return valid ? JSON.stringify(values) : "";
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
