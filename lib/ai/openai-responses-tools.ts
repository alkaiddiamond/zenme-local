type SearchableMessage = {
  role: string;
  content: string;
};

export function createOpenAiWebSearchCommands(
  messages: SearchableMessage[],
) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();
  if (!latestUserMessage) return null;

  const url = latestUserMessage.match(/https?:\/\/[^\s<>\])}"']+/i)?.[0];
  if (url) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, "");
      const page = parsed.pathname === "/" ? "" : parsed.pathname;
      const question = latestUserMessage.replace(url, " ").replace(/\s+/g, " ").trim();
      return {
        search_query: [{
          q: `site:${hostname}${page} ${question}`.trim().slice(0, 1_000),
        }],
        response_length: "long" as const,
      };
    } catch {
      // Fall through to intent-based search for malformed URLs.
    }
  }

  return null;
}
