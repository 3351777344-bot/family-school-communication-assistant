# 资料入库 runbook

每来一批新资料，按下面 7 步做。工具在仓库外：`E:\家校协同项目\tmp\kb\`（台账与 `kb.py` 不进版本库）。

## 七个步骤

1. **登记批次**：`docs/research/入库批次/<日期>_<批次>.md`，写来源、日期、sha256、文件清单、目标范围。
2. **解析**：docx/pptx/pdf → `tmp/teacher_review/<编号>.json`；扫描件走 OCR，放 `tmp/ocr_pages/<编号>/`。
3. **预填台账**：`python tmp\kb\kb.py make-ledger`（首次或需要重建时）；日常在现有台账加行。
4. **提炼**：每条填摘录、要点、做法、阶段、场景、家长反应/学生意愿、优先级、出处定位、迁移标注；不用的行填“除外 + 原因”。
5. **校验**：`python tmp\kb\kb.py lint`，必须零错误。
6. **转卡**：`python tmp\kb\kb.py build` → `teacher-methods.preview.json`，人工抽查后合并进 `app/teacher-methods.json`。
7. **记录**：更新 `docs/development/progress.md`，写批次结案。

## 回归四件套（每次合并前）

1. `kb.py lint` 零错误零警告。
2. `npm run test:server` + `npm run test:web` 全绿（含检索可达性用例）。
3. 从 `evals/cases/communication-v1.json` 抽 5 个用例跑质量评测，对比上一版综合分，跌幅超过 0.2 要解释。
4. prompt 体积对比：均值涨幅超过 20% 要说明原因。

## 三个“停下来”的闸门

1. **现有 9 个步骤装不下**（大量内容讲现有步骤之外的事）：记入“候选新步骤”，等评测证明需要再加，不顺手加 `move`。
2. **`when` 需要第三个以上维度**：先评审标签体系，再扩。
3. **与现有卡重复率超过 15%**：先合并去重，再入库。

## 容量阈值

| 触发条件 | 动作 |
|---|---|
| 库 > 300 张 | 标签评审 + 重复合并 |
| 某步候选 > 30 张 | 检查是否该拆步骤，或标签没打对 |
| 同一 `when` 组合 > 10 张 | 合并到 5 张以内，其余 `status: retired` |
| 评测集 < 30 用例 | 每批至少加 2 个新情境用例 |

## 卡片字段约定

- `when`：`parentReaction` / `studentWish` / `stage` / `chips`，取值必须来自输入契约；不填等于“通用卡”。
- `priority`：1–5，只用于同步骤排序，不表达重要性。
- `status`：`active` / `retired`；退役不删除。
- `batch`：批次号，便于回溯。

## 安全与合规

- 台账、提取文本、原始资料一律不进 git。
- 案例、人名、机构、联系方式、诊断、评分、危机操作不进库。
- 专业资料迁移的卡片必须标 `迁移标注=是`，并在做法里写“待核对”。
