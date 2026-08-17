import { describe, expect, it } from "vitest";

import { buildAgentQuestionSubmission, type AgentQuestion } from "@/components/zenme/agent-question-form";

const questions: AgentQuestion[] = [{
  question: "采用哪个方案？",
  header: "方案",
  options: [
    { label: "A", description: "使用现有实现", preview: "A preview" },
    { label: "B", description: "重新设计" },
  ],
  multiSelect: false,
}];

describe("buildAgentQuestionSubmission", () => {
  it("keeps the selected answer while returning preview and notes as annotations", () => {
    expect(buildAgentQuestionSubmission(
      questions,
      { "采用哪个方案？": ["A"] },
      { "采用哪个方案？": "优先保持兼容" },
    )).toEqual({
      answers: { "采用哪个方案？": "A" },
      annotations: {
        "采用哪个方案？": {
          preview: "A preview",
          notes: "优先保持兼容",
        },
      },
    });
  });

  it("uses free-form text as the answer when no option is selected", () => {
    expect(buildAgentQuestionSubmission(
      questions,
      {},
      { "采用哪个方案？": "使用其他方案" },
    )).toEqual({
      answers: { "采用哪个方案？": "使用其他方案" },
    });
  });
});
