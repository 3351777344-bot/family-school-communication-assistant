# 知识库交接文档（给 AI 协作者）

> 用途：把“教师资料 → 知识卡片”这条线的工作、判断和踩过的坑，完整交给另一个 AI（或人）。
> 生成时间：2026-11-18。所有路径只在本机有效，外部协作者只需理解结构与规则。

## 0. 一句话背景

这是一个**辅导员用的家校沟通准备工具**：老师填一段学生情况，系统生成“沟通要点 + 给家长的底稿 + 追问回应”。知识库不是给模型“读资料”，而是给模型**每步最多 8 条可引用的原则**，且引用必须逐字可溯源。

## 1. 不可违反的产品边界

| 约束 | 具体表现 |
|---|---|
| 只用输入事实 | 底稿里的每个数字、时间、次数都必须能在老师输入里找到；服务端校验 `usedEvidence` |
| 不诊断 | 输出禁止“抑郁/焦虑/确诊”等诊断结论，违反会被 `prepare-output.js` 拦截并重写 |
| 不承诺结果 | 不得说“保证不留档”“一定能解决” |
| 不做危机研判 | 出现安全信号时不调模型，直接转人工；工具只提示，不确认也不排除风险 |
| 案例不入库 | 真实案例（含脱敏）不进知识库、不进模型上下文 |

## 2. 系统结构

```
app/
  knowledge.js          卡片加载 + 校验 + 检索选取（核心）
  teacher-methods.json  老师课件卡（tier 2，当前 90 张）
  reference-cards.json  项目自写候选卡（tier 3）
  kb_v3.json            通用方法卡（tier 1）
  prepare.js            组装 prompt：moves + evidence + 每步 sources
  prepare-output.js     输出校验：步骤、引用逐字、事实锚定、禁用表述
  communication-safety.js  PII 脱敏 + 安全信号正则
  config.js             SOURCE_SELECTION / SOURCE_TIERING / MAX_SOURCES_PER_MOVE / EXPOSE_APPLICATIONS
tests/                  62 个服务端测试 + 9 个前端测试
evals/cases/            100 个合成用例（frozen v1/v2）+ 20 个开发用例（v1）
evals/runs/             对照实验与质量评测报告
```

数据流：

```
输入 → redactInput（去号码）→ 安全正则命中？→ 是：manual_review（不调模型）
                              ↓ 否
findReferences(scene) → 方法卡 + 老师卡 + 候选卡（按 tier）
        ↓
selectSources(references, move, context) → 每步 ≤8 张
        ↓
messagesFor() → prompt（每步自带 sources）
        ↓
模型输出 → parsePlan 校验（引用必须逐字、步骤必须合法、事实必须可溯）→ 结果
```

## 3. 卡片规范

```json
{
  "id": "teacher-046-1",
  "version": 1,
  "title": "先确认双方各自希望解决什么",
  "reviewStatus": "待老师核对",
  "sourceLocation": { "title": "3.4.2资源4视频-家校沟通策略.docx", "locator": "3.4.2 讲义第 8 页" },
  "supports": ["hear-parent"],
  "passages": {
    "hear-parent": [{ "quote": "尝试找到双方需求的共同点，为达成共识做好铺垫", "action": "先听家长和学生分别希望解决什么，复述并请对方确认。" }]
  },
  "when": { "parentReaction": ["refuses"] },
  "priority": 4,
  "status": "active",
  "batch": "2026-11-A1"
}
```

启动时强制校验：id 正则、`quote` 6–140 字且首尾无空格、`action` 非空、`supports` 必须是合法步骤、`when` 取值必须来自输入契约、`priority` 1–5、`status` active/retired。**坏数据会让服务启动即报错**，这是有意的。

权威度分层：`tier 1` 通用方法卡（公开方法）> `tier 2` 老师课件卡 > `tier 3` 项目自写候选卡。`SOURCE_TIERING=1` 时，候选卡只在没有 tier≤2 覆盖该步骤时出现。

选取两种模式：

- `order`：数组顺序取前 N 张。**问题：排在后面的卡永远选不到。**
- `retrieval`（当前默认）：先按 `when` 排除与输入矛盾的卡（输入没填的维度不排除），再按“情境命中×3 + priority×0.5 + 中文 2-gram 重合度×2”排序，取前 N 张；没有命中时回落到通用卡。

## 4. 当前状态（截至 2026-11-18）

- 卡片：**90 张**（原有 30 + 批次 A1 新增 60），全部 `待老师核对`。
- 每步卡数：hear-parent 47、review-observations 14、study-support 13、review-records 8、return-to-records 8、check-disclosure 5、check-policy 5、contact-time 4、respect-wish 2。
- 默认：`SOURCE_SELECTION=retrieval`、`MAX_SOURCES_PER_MOVE=8`、`SOURCE_TIERING=1`、`EXPOSE_APPLICATIONS=0`。
- 测试：`npm run test:server` 62 通过、`test:web` 9 通过。
- 提交（都在本地，**未 push**）：`7d4f07e`、`0456c99`、`b3a6966`、`0235a41`、`afa5fec`、`4cb9466`、`2be464e`；tag `snapshot-2026-11-18`、`v0.2.0-knowledge`。
- 批次 A1：72 份资料 → 12 份产出 60 条入库；53 份除外；5 份参考；2 份待定。

评测（20 个开发用例，deepseek-flash，1 轮，同模型 5 项 1–5 分打分）：

| 指标 | A 30 卡/order/8 | B 90 卡/order/8 | C 90 卡/retrieval/8 |
|---|---:|---:|---:|
| 综合 | 4.38 | 4.40 | 4.41 |
| 事实锚定 | 4.50 | 4.72 | 4.61 |
| 具体性 | 4.00 | 4.00 | 4.06 |
| 贴合度 | 4.61 | 4.61 | 4.56 |
| 少空话 | 4.39 | 4.28 | 4.28 |
| 可直接用 | 4.39 | 4.39 | 4.56 |
| 首次结构通过率 | 94.4% | 94.4% | 100% |
| 无引用要点 | 13 | 2 | 2 |
| prompt 均值 | 4188 | 5009 | 4981 |

配对 bootstrap（按用例）：C−A +0.033 [−0.133, +0.211]，C−B +0.011 [−0.211, +0.222]，B−A −0.022 [−0.222, +0.167]。**质量差异在噪声内**；检索被选为默认，是因为它解决了“排在数组后面的卡永远选不到”，不是因为分数更高。

## 5. 已验证 / 已否定的假设（不要重复踩）

| 假设 | 结论 | 证据 |
|---|---|---|
| 把“具体做法”也发给模型能提高卡片选中率 | **否定** | 课件卡占比 23.3%→24.4%（区间跨 0），候选卡 −23.9pp，prompt +29%，首次通过率 −12.1pp |
| 候选太多是模型挑不准的原因 | **成立** | 分级 + 每步上限 8：课件卡 23.3%→51.2%，通过率 80.6%→97.2%，prompt −23% |
| 检索比顺序更能提升回答质量 | **未成立（差异在噪声内）** | A/B/C 三臂，配对区间均跨 0 |
| 检索能解决“新卡永远选不到” | **成立** | 默认 retrieval 后，新卡在三个场景的 hear-parent 各出现 6–7 张 |
| 真实案例（脱敏）能提高质量 | **未验证，且不建议** | 案例会离开机器发给第三方 API；再识别风险与版权风险都未解 |

## 6. 未完成 / 下一步

1. **老师核对**：90 张全部待核对；对外使用前需要一版确认清单。
2. **案例 → 句式卡**：交接包（批次 B1）正在让对方处理 46 份含案例资料，产出“案例卡”；正确路径是先挑 5 张**合成**案例做 few-shot 对照，有效再把“家长说 X → 老师可回 Y”提炼成句式卡，案例本身永不入模型。
3. **扩库**：只有证明检索有效后才扩到 200+；当前证据不足。
4. **危机分级**：目前只有一条 7 词正则 + 场景“危机前期”，未实现 L0–L3 分级（L1 弱信号提示 / L2 不生成转人工 / L3 强信号加计划转紧急流程）。

## 7. 红线（AI 协作者必须遵守）

1. **不 push、不碰远端**；所有提交只留本地。
2. `tmp/` 里的台账、原文、OCR、工具**不进 git**。
3. 不把真实案例（含脱敏）发给模型；不把案例写进卡片摘录。
4. 不做全文 RAG：现有校验只认卡片内逐字原文，全文检索会绕过审核。
5. 不为了“用上资料”而无限加卡：每步上限 8，加卡前先问“它会替换掉哪张”。
6. 不删旧卡：用 `status: retired` 退役，保留可追溯性。

## 8. 常用命令

```bat
npm test
node scripts/evaluate-quality.js --label=X --selection=retrieval --budget=8 --judge=1
python tmp\kb\kb.py lint --file "tmp\kb\知识台账_v1.xlsx"
python tmp\kb\kb.py build --file "tmp\kb\知识台账_v1.xlsx"
python tmp\kb\case_lint.py "tmp\kb\交接\知识台账_交接版.xlsx"
node tmp\kb\merge.js          :: 演练
node tmp\kb\merge.js --apply  :: 合并（会先备份 .bak）
```

## 9. 给接手者的五个问题（先回答，再给建议）

1. 新增一张卡，它会在哪些步骤被选中？为什么可能选不到？
2. 如果发现某一步有 30 张卡，你先做什么？为什么不是继续加卡？
3. 什么情况下应该改架构（加字段、改检索、拆步骤），而不是加卡片？
4. 为什么案例不能直接进库？如果要利用案例，正确路径是什么？
5. 你打算用什么方法证明“这次改动让回答变好了”？需要多少样本？

## 10. 待确认

- 老师核对由谁做、什么时候做。
- 两本书（510 页）的案例是否只做内部整理。
- 是否愿意把 `MAX_SOURCES_PER_MOVE` 从 8 降到 6（未验证）。
