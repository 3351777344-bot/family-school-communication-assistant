import type { FactCandidate, InputEvidence } from "../types";

const kinds: Record<FactCandidate["kind"], string> = {
  record: "记录",
  observation: "观察",
  report: "转述",
  unclassified: "来源需核对",
  context: "沟通背景",
  speculation: "推测",
};

// 原型「五、P4」：事实核对清单逐条比对原文。这里只呈现原文，不代替辅导员判断。
export function FactList({
  facts,
  evidence,
}: {
  facts: FactCandidate[];
  evidence: InputEvidence[];
}) {
  if (!facts.length) return null;
  return (
    <section className="card supporting fact-review" aria-labelledby="fact-list-title">
      <h2 id="fact-list-title">事实原文对照</h2>
      <p className="muted compact">
        下面把输入原文按来源拆开，方便逐句对照底稿。标注「转述」「推测」或「待核对」的内容，写进底稿前请自行确认。
      </p>
      <ul className="fact-list">
        {facts.map((fact, index) => {
          const original = evidence.find((item) => item.id === fact.field);
          return (
            <li className="evidence-item" key={fact.id} aria-labelledby={`fact-${index}`}>
              <h3 id={`fact-${index}`}>
                {fact.source} · {kinds[fact.kind]}
              </h3>
              <p>{fact.quote}</p>
              <p className="muted fact-meta">
                {fact.time && <span>原文时间：{fact.time}</span>}
                {fact.uncertain && (
                  <span>{fact.group ? "与同段记录或转述一并核对" : "情况仍待核对"}</span>
                )}
              </p>
              {original && (
                <details className="fact-source">
                  <summary>查看{original.label}</summary>
                  <p>
                    {original.quote.slice(0, fact.start)}
                    <mark>{original.quote.slice(fact.start, fact.end)}</mark>
                    {original.quote.slice(fact.end)}
                  </p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
