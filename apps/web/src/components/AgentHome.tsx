import { agentPages, pageHref, type AgentPage } from "../navigation";
import type { Health } from "../types";

const agents = [
  { id: "analysis", description: "梳理学生记录和待核实事项。", action: "开始分析" },
  { id: "form", description: "整理沟通要点，起草家长消息。", action: "准备沟通" },
  { id: "practice", description: "与模拟家长对话，练习回应。", action: "进入演练" },
  { id: "review", description: "回看演练，获取具体改进建议。", action: "查看复盘" },
] satisfies { id: AgentPage; description: string; action: string }[];

export function AgentHome({ health, healthError }: { health: Health | null; healthError: boolean }) {
  const unavailableText = health ? "暂未开放" : healthError ? "请刷新重试" : "连接中…";

  return (
    <>
      <div className="home-heading">
        <h1 id="home-title" tabIndex={-1}>家校工作台</h1>
        {health?.mock && <span className="mode-badge mock">离线示例</span>}
        {healthError && <span className="mode-badge" role="status">连接异常</span>}
      </div>
      <div className="agent-grid">
        {agents.map(({ id, description, action }) => {
          const enabled = id === "form" || (id === "analysis" ? health?.analysisEnabled : health?.practiceEnabled);
          const title = agentPages[id].title;

          return (
            <article key={id} className={`agent-card agent-${id}`}>
              <h2>{title}</h2>
              <p>{description}</p>
              {enabled ? (
                <a className="agent-card-action" href={pageHref(id)} aria-label={`${action} · ${title}`}>
                  {action}<span aria-hidden="true">→</span>
                </a>
              ) : (
                <span className="agent-card-status">{unavailableText}</span>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
