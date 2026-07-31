type SearchableMessage = {
  role: string;
  content: string;
};

export function createOpenAiWebSearchCommands(messages: SearchableMessage[]) {
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
      const brand = hostname.split(".")[0];
      const page = parsed.pathname === "/" ? "" : parsed.pathname;
      const question = latestUserMessage.replace(url, " ").replace(/\s+/g, " ").trim();
      return {
        search_query: [{
          q: `site:${hostname}${page} ${brand} company about ${question}`.trim().slice(0, 1_000),
        }],
        response_length: "long" as const,
      };
    } catch {
      // Fall through to intent-based search for malformed URLs.
    }
  }

  if (!needsCurrentWebInformation(latestUserMessage)) return null;
  return {
    search_query: [{ q: latestUserMessage.slice(0, 1_000) }],
    response_length: "long" as const,
  };
}

function needsCurrentWebInformation(message: string) {
  return /(搜索|搜一下|查一下|查询|查找|联网|网上|最新|最近|今日|今天|当前|现在|新闻|价格|汇率|天气|赛程|比分|政策|法规|现任|官网|来源|链接|search|look\s*up|latest|current|today|news|price|weather)/i.test(message);
}
