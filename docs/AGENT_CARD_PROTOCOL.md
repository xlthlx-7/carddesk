# 接页 Agent 文件协议 v1

版本：protocol_version=1，instruction_version=1。插件实现：0.3.0（P3）。

## 用户操作

1. 在 Obsidian 命令面板执行“接页：导出 Agent 说明”。
2. 配置原文目录、新卡输出根目录、允许检索目录、排除目录；允许/排除多个目录使用英文逗号。预览后确认导出。
3. 在本地 Agent 中提供 Vault 的实际路径，指定导出说明及具体任务。例如：“阅读 Carddesk/Agent拆卡说明.md，处理 Sources/book/source.md，输出到新的 Cards/book-v1/，不修改其他笔记。”
4. Agent 完成后，在 Obsidian 执行“检查 Agent 卡片包”，选择 manifest。无错误时可打开入口阅读。

插件不启动 Agent、不提供 Agent SDK/MCP 连接、不授予文件权限、不调用模型或嵌入服务。Agent 访问范围与实际执行授权由用户在 Agent 侧决定；配置说明不构成操作系统权限隔离。

两份模板内置在 main.js 中：源码是 `obsidian-plugin/resources/agent/split-cards.md` 与 `inspect-relations.md`，不依赖开发仓库文件存在。首次导出到 `Carddesk/Agent拆卡说明.md`、`Carddesk/Agent关联检查说明.md`；有差异时预览逐行差异并另存 `.v1-N.md`，不覆盖任何已有说明。内容完全一致则复用已有文件。后续任务应引用最新选定的说明路径，旧说明不会被 Agent 自动替换。

## 卡片

每张是普通 UTF-8 Markdown 笔记，可在没有接页时按原生链接阅读。

```markdown
---
carddesk_schema: 1
card_id: book-v1-mechanism
card_role: explanation
source_path: Sources/book/source.md
source_locator: 第三章 / 第二节
---
# 核心机制

本层有独立完整的解释。需要操作细节时展开[[Cards/book/例子|一个例子]]。
```

- `carddesk_schema` 数值固定为 1。
- `card_id` 非空字符串，全库唯一，修订/移动时保持稳定。
- `card_role` 取 entry/explanation/example。它是内容角色，不是强制父子分类。
- `source_path` 是存在的 Vault 相对来源文件，必须列在本包 sources 中。
- `source_locator` 非空、可核对的章节/标题/段落定位。不要编造页码；第一版一个主来源。
- 正文建议 200～500 字符，非硬限制；围绕一个疑问形成完整解释，不能为字数机械拆分。
- 链接采用 `[[Vault相对完整路径|自然语言入口]]`，省略 .md。既有卡可直接引用；不强制双向链接，允许共享卡和循环。
- 标题/块链接与嵌入是原生能力，但本协议建议整卡链接以支持渐进阅读。代码块中的链接示例、外部 URL 不作为包内关联。

## 文件清单 manifest

清单放在 `Carddesk/packages/<唯一包标识>.json`，最后写入。插件命令只列出这个目录及其子目录中的 JSON 清单。

```json
{
  "schemaVersion": 1,
  "packageId": "book-v1",
  "title": "书籍主题",
  "entry": "Cards/book/入口.md",
  "files": ["Cards/book/入口.md", "Cards/book/例子.md"],
  "sources": ["Sources/book/source.md"]
}
```

entry 必须属于 files。files 只列本次产出的 .md 卡片，sources 列全部主来源；二者不重复。正文链接是关联唯一来源，清单不复制关系表。清单为完成标记，不提供跨文件事务。

路径不接受绝对路径、反斜杠、`..`、`.`、空路径段、隐藏目录、控制字符和协议/锚点分隔符。使用真实 Vault 相对路径；不要用文件名中的特殊符号模拟层次。

当前单包 files/sources 各最多 1000 项；manifest 和单卡各最多 1 MB。分批处理长书，各包独立校验，不等于整本书只允许 1000 张卡。

## 校验行为

错误：格式/版本/路径不合法，重复文件，入口不在包内，卡片或来源缺失，缺少必需属性，非法角色，重复 card_id，断链或无法解析的内部目标。

警告：入口角色不是 entry、正文长度超建议、非整卡链接/嵌入、入口无法沿包内整卡正文链接到达的卡片。允许外部旧卡引用；包内可达性不通过外部卡绕行计算。

使用宿主解析元数据，不用正则把全文中的 `[[...]]` 都当成链接。元数据尚未就绪时提示重新检查。存在的图片/PDF 等附件不被误报成断链。报告可定位已有文件；无错误时提供“以接页打开入口”。

校验不修改、移动或删除卡片，不锁定普通阅读。它确认文件与关系结构，不会判断来源陈述是否真实、locator 是否准确，也不证明 AI 没有遗漏观点。开始检查后若继续修改相关笔记，应重新检查。

## 关联检查报告

关联检查说明要求：指定源卡/批次 → 生成 3～6 个理解追问 → 本地关键词检索 → 候选全文判断 → 只读建议报告 → 用户批准后核对原文再修改。

报告新建于 `Carddesk/reviews/<review-id>.md`，每条至少有 suggestion_id、源/目标路径及 ID（如有）、关系类型、原始问题、实际搜索词和候选、两端连续依据、插入位置及修改前后文本、读者收益、proposed/applied/skipped 状态。

先用关键词文件搜索；Q1 才提供统一检索入口，Q2 保留关键词并加入向量/混合召回。当前不宣称已有搜索服务或向量数据库。插件不解析/批准/执行报告，只提供格式和示例。

## 示例

`obsidian-plugin/fixtures/vault/` 提供原创示例来源、10 张新卡、1 张可引用旧卡、有效 manifest、两份故障 manifest 及关联报告。复制到测试 Vault 后可直接校验。原始示例不是某本真实书籍的 AI 拆解结果，不代表已完成模型质量测评。
