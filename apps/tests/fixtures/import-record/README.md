# 虚构导入测试文件

全部内容为合成资料，不含真实个案。Node 回归直接读取这些文件，无需安装 Python。

- `records.docx`：中文段落及表格。
- `records.xlsx`：可见中文记录、隐藏工作表／行／列，以及无缓存结果的超链接公式；公式中的回环地址不得被访问。
- `records.pdf`：两页含文本的英文虚构记录。
- `empty.*`、`scanned.pdf`：空白或仅含图片，无可提取文本。
- `encrypted.pdf`：合法加密 PDF，测试口令为 `synthetic-password`。
- `encrypted-flag.docx`：ZIP 加密标记拒绝测试，不用于正常解析。
- `expanded-budget.docx`、`total-budget.docx`、`entries-budget.xlsx`：压缩后很小，但分别超过单条目、总解压字节或条目数预算。

需要重新生成时运行 `python apps/tests/fixtures/import-record/build-fixtures.py`。生成脚本依赖 python-docx、openpyxl、reportlab、pypdf 和 Pillow，仅用于维护测试资料。
