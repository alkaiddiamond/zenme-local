import Ajv, { type AnySchema, type ErrorObject } from "ajv";

const workflowResultValidator = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
});

export function parseWorkflowStructuredResult(value: string, schema: unknown) {
  if (!schema) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Workflow Sub-agent 未返回有效 JSON");
  }
  let validate: ReturnType<Ajv["compile"]>;
  try {
    validate = workflowResultValidator.compile(schema as AnySchema);
  } catch (error) {
    throw new Error(`Workflow JSON Schema 无效：${error instanceof Error ? error.message : "无法编译"}`);
  }
  if (!validate(parsed)) {
    throw new Error(`Workflow Sub-agent 返回值不符合 JSON Schema：${formatSchemaErrors(validate.errors)}`);
  }
  return parsed;
}

function formatSchemaErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) return "未知校验错误";
  return errors.slice(0, 5).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "不符合约束"}`;
  }).join("；");
}
