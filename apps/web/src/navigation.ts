export const agentPages = {
  analysis: { title: "学生信息分析", description: "把零散记录整理清楚，为下一次沟通找到重点。", label: "信息分析 Agent" },
  form: { title: "家校沟通助手", description: "从已知情况出发，准备一份自然、清晰的家长沟通底稿。", label: "沟通助手 Agent" },
  practice: { title: "场景模拟", description: "在不同的家长情境中，找到自己的沟通节奏。", label: "场景模拟 Agent" },
  review: { title: "沟通复盘", description: "回看关键表达，让每一次练习都有收获。", label: "沟通评估 Agent" },
} as const;

export type AgentPage = keyof typeof agentPages;
export type Page = "home" | AgentPage;

export function pageFromHash(hash: string): Page {
  const value = hash.replace(/^#\/?/, "");
  return Object.hasOwn(agentPages, value) ? value as AgentPage : "home";
}

export const pageHref = (page: Page) => page === "home" ? "#/" : `#/${page}`;
