# 本地原型服务

启动与API配置以项目根目录 README.md 为准。服务自动读取项目根目录.env，Shell变量优先；密钥不从浏览器输入。

- `server.js`：本地 HTTP 服务、静态资源和模型配置入口。
- `prepare.js`：沟通准备编排；模型写沟通要点与家长底稿，服务端做锚定校验与一次修复。
- `prepare-output.js`：校验步骤编号、要点、底稿、事实锚点，并拦截诊断、处分、上报类表述和编造数字。
- `preparation-gates.js`：保密与「仅向学生核对」的提示、信息不足识别。不再阻断生成。
- `facts.js`：把输入原文切成事实条目，供 P4 事实核对清单对照。不承担入稿授权。
- `communication-moves.js`：按场景提供可选沟通步骤、常见反应和离线示例话术。
- `communication-safety.js`：输入脱敏与人身安全提示触发条件（E2）。
- `knowledge.js`：按场景和步骤提供通用方法、老师课件与候选资料卡；候选卡以「待核对」身份参与。
- `config.js`：.env解析、服务商配置、模型参数，以及资料选取策略（`SOURCE_TIERING`、`MAX_SOURCES_PER_MOVE`、`EXPOSE_APPLICATIONS`）的名称、默认值与取值校验。启动时校验一次，写错直接报错。
- `contracts.js`：输入与固定流程契约，含原型四项快速标签。
- `model-client.js`：模型请求与可恢复错误分类。
- `家校沟通助手_原型v3.html`：保留的旧模型联调页面；新版首页位于 `apps/web/`，由根目录 npm start 构建后提供。
- `家校沟通助手_演示版.html`：固定示例界面。
- `kb_v3.json`：当前知识库。未审核条目不能当成本校制度。

接口只有 `GET /api/health` 和 `POST /api/prepare`。逐事实入稿接口 `/api/draft/facts` 已下线，事实核对改为结果区内的对照清单。

默认.env为MOCK=1。真实模式使用AI_PROVIDER指定的服务商；千问读取DASHSCOPE_API_KEY，DeepSeek读取DEEPSEEK_API_KEY，各自也支持QWEN_KEY_FILE/KEY_FILE指定的项目外文件。密钥为空会明确报错，不隐式切换服务商。

当前.env仅保存服务端配置，已被版本库忽略。请勿公开分享。模型版会发送去除部分号码格式的输入到所选API，自动脱敏无法可靠覆盖姓名、班级和间接身份线索，试用使用虚构场景。健康检查不会发出付费请求；显式模型预检由scripts/check-model.js执行。
