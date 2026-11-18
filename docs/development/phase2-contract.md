# 阶段 2 开发接口约定

2026-11-18。仅虚构培训案例，规则为项目内练习草案，待业务审核，不代表校方正式标准。模拟和评估分开调用；只有用户明确结束后点击复盘才评估。不接收真实个案或阶段 1 的分析上下文。

所有接口成功返回 `{ok:true,data}`，错误 `{ok:false,code,error}`。功能开关 `PRACTICE_ENABLED=0` 同时关闭目录和全部写接口；health 返回 `practiceEnabled`。会话使用独立 HttpOnly `practice_session` cookie、30 分钟内存 TTL。校内本地演练账号继续按 scene 授权。

## 目录

`GET /api/practice/catalog` 返回 `{cases, rubricVersion, criteria, reviewStatus}`。

案例 `{id,title,scene,difficulty,description,objective,roleCard:{name,relationship,attitude,knownFacts:string[],opening}}`。至少三个虚构案例（学业否认、焦急询问、协作沟通），禁止危机场景。评价项 `{id,title,description,anchors:string[]}`，固定编号 `listening,facts,boundaries,collaboration,closure`，每项 1–4 分行为锚点。reviewStatus 文字明确待业务审核。

## 会话

`POST /api/practice/start`：`{caseId,requestId}`。

`POST /api/practice/turn`：`{sessionId,expectedVersion,requestId,message}`，消息 1–1000 字。

`POST /api/practice/end` 与 `/api/practice/review`：`{sessionId,expectedVersion,requestId}`。

start/turn/end/review 返回完整快照：`{sessionId,caseId,scene,status,version,turns,expiresAt,flags,replyUnavailable?,review?,generation?,notes?}`。status 为 `active|ended`。start version=0，初始家长开场 turn；turn/end 各加 1。review 不改变 version 或 ended 状态。turn `{id,role:'parent'|'counselor',content}`，稳定唯一编号，可作 DOM 锚点。最多 20 个辅导员回合，达到后提示主动结束，不隐式发起复盘。end 后不可再 turn。

练习者的差回答、风险词、武断诊断、威胁或不符合常见步骤的表达均是待复盘材料，不触发暂停或拒绝评价。安全校验针对生成的家长回复和改进建议；问题原话允许出现在证据与分析中。家长回复校验经一次修复仍失败时，保存本轮练习发言、递增版本、保持 active，返回 `replyUnavailable:true`，不显示不合格家长回复，仍可继续或结束后复盘。网络失败不提交该轮，按同一 requestId 重试；同一 requestId 不同 payload 须拒绝。expectedVersion 防止并发旧请求串入；同一请求在途合并、成功重放不重复提交。

generation `{promptVersion,attempts,usage,validationFailures:[{field,rule}]}`；离线 flags 明确 `离线交互示例`，评价标注离线示例。只日志元数据。结果校验失败最多修复一次，修复上下文携带前次回答及失败字段；错误响应和日志不可暴露模型原文或记录。

review `{rubricVersion,summary,items,nextExercise}`，item `{criterionId,score:number|null,feedback,evidence:[{turnId,quote}],alternative,practice}`。五项各一次，score=1..4。每条非空 evidence 必须逐字取自本会话 counselor 回合，且来源编号存在；无适用证据时 score=null 并说明暂无法评价，不编造引句。summary、alternative、practice 为学习建议，不作正式能力判定。无辅导员回合时拒绝 review。复盘失败仍保留 ended 状态，允许单独重试。

明确错误可作为低分的负面证据，不要求套用固定句式或顺序；简短自然但有效的表达也可获得合理反馈。事实中的“本周”等时间背景不等于模型承诺联系期限。评价针对已发送的练习发言，不能因模型回复缺失或末尾家长问题尚未回复而扣分。

## 后端模块

`app/practice.js` 导出 `createPracticeWorkflow({mock,complete,ttlMs,now,maxSessions})`，返回 `catalog(),start(input,owner),turn(input,owner),end(input,owner),review(input,owner),sceneFor(sessionId,owner)`。错误复用 InputError/OutputError/ModelError。案例及规则放 `app/practice-cases.json`、`app/practice-rubric.json`，纯数据、可审查且版本化。

前端独立 `practice.ts` 与 `components/PracticeWorkbench.tsx`；保留现有表单和分析入口。失败保留输入、对话与已生成反馈；切换入口取消前端请求并忽略迟到响应，允许重试同一请求恢复服务端已提交结果。不使用浏览器永久存储保存对话。
