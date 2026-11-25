# karpathy-llm-wiki × 接页：验证用补充说明

本说明叠加在已审阅的上游 Skill 之上。本次没有修改、注册或全局启用该 Skill，也没有将检索接入插件。只操作独立测试库的 `ReuseWiki/` 与相应 package/review 文件。

## 加工约束

1. 使用 `raw/<topic>/`、`wiki/<topic>/`、`wiki/index.md`、`wiki/log.md`，保留 Raw、Sources、Updated 信息。原始资料不改写。
2. 先读索引并检索候选，使用 `qmd get` 读取全文，再判断 New / Update / Disputed / No material。候选相似性不能直接变成正式关联。
3. 卡片围绕一个问题，建议正文 200～500 字，入口先提供可独立理解的概览。正文里使用有解释意义的相对 Markdown 链接，不以 See Also 列表替代所有阅读入口。
4. 每张卡补充 `carddesk_schema: 1`、全库唯一且稳定的 `card_id`、`card_role`、Vault 相对 `source_path`、`source_locator`。`source_path` 与相对 Raw 链接指向同一原始资料；前者供插件校验，后者供 Skill 追溯。
5. 新增 `Carddesk/packages/<package>.json`，遵循 [卡片协议](../docs/AGENT_CARD_PROTOCOL.md)。入口为 `entry` 角色；不要把 wiki/index.md、wiki/log.md 或 raw 当成知识卡包文件。
6. 已有卡不是因为新资料又提到同一概念就必须更新。确实新增证据才更新；冲突记录条件与来源。跨包旧卡保持原 ID，不复制。没有依据可以不连。
7. 运行上游只读证据检查与插件卡片包校验。上游检查脚本即使报告异常也可能返回退出码 0，必须读取报告；它不做完整的语义事实核验。

## 本次 QMD 调用方式

从项目根目录执行。`jieye-reuse` collection 只收录 `test-vault/ReuseWiki/wiki/reading/`，真实中文材料的 `aipm` collection 只收录 `wiki/aipm/`；不收录 raw、索引目录、日志、插件内部状态或其他 Vault。中文 collection 的路径映射同理为 `qmd://aipm/<file>.md` → `ReuseWiki/wiki/aipm/<file>.md`，处理百分号编码并校验路径。

```sh
sh reuse-eval/qmd.sh update
sh reuse-eval/qmd.sh search '认知负担' -c jieye-reuse --json -n 5
sh reuse-eval/qmd.sh get qmd://jieye-reuse/cognitive-load.md --full
```

Agent 可先提出问题“为什么不能把背景一次铺开？”，再自行提炼关键词“认知负担”“按需展开”。这是 Agent 的问题规划，不是 QMD 自动证明关联。中文整句查询的效果需要单独测评，本次只测试了术语查询。

本次固定映射：`qmd://jieye-reuse/<file>.md` → `ReuseWiki/wiki/reading/<file>.md`。`probe.py` 检查 collection、路径和文件存在；**不保证索引内容仍最新**。正式连接前应显式 update、读取当前文件全文、检查来源，再生成带关系类型与依据的建议。不要将 QMD URI 写进卡片作为 Obsidian 内链。

## 混合检索复跑命令

模型下载问题已解决，官方文件哈希已核对，二十六张文档已有向量。以下为复跑入口，真实中文对照与关联结果见 [第二轮说明](aipm/README.md)：

```sh
sh reuse-eval/qmd.sh embed
sh reuse-eval/qmd.sh status
sh reuse-eval/qmd.sh query 'lex: 认知负担
vec: 为什么把所有背景一起铺开会妨碍读者理解' --no-rerank -c jieye-reuse --json -n 5
```

使用 Agent 提供的 typed queries，避免额外下载查询扩写模型；`--no-rerank` 避免下载重排模型。只在向量数与待嵌入数量符合预期时记为混合测试。缺模型时本次明确改用 `search` 并标注 keyword-only，不把 `query` 命令名当成混合成功的证据。未测试自动扩写、重排、MCP、后台监听或插件内调用。

模型切换要重建相应向量。本脚本使用上游文档列出的 Qwen 中文嵌入 GGUF；本机已下载并验证 SHA-256。正式质量结论仍需独立测评。纯向量验证使用 `query 'vec: ...' --no-rerank`，避免 QMD 2.9.0 的 vsearch 自动扩写额外加载模型；不要把 query 命令名本身当成使用向量的证据。
