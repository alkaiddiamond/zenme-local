export function buildContextualImageGenerationPrompt(input: {
  context: string;
  prompt: string;
}) {
  const prompt = input.prompt.trim();
  const context = input.context.trim();

  if (!context) {
    return prompt;
  }

  return [
    "请根据以下上游画布内容理解用户指代，并执行图片生成任务。",
    "",
    "上游画布内容：",
    context,
    "",
    "用户图片生成指令：",
    prompt,
  ].join("\n");
}
