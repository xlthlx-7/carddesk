# 接页本地检索适配层（协议 v1 / 查询策略 v2）

依赖 QMD 2.9.0 的公开 SDK，复用其索引、BM25 和向量召回。薄适配层管理范围、文件映射、索引新鲜度、当前全文、明确回退及有界关键词组合排序，不生成卡片、不判定语义关系、不写正文、不运行后台服务。当前验证平台为 macOS 桌面。

## 准备

在接页项目根目录运行。Node 必须 22+；本机为 `/usr/local/bin/node`。固定依赖已在 `.reuse-eval/qmd/`；干净环境将 `reuse-eval/qmd-dependency/package.json` 与 package-lock.json 复制到该目录，用 Node 22+ 的 npm ci 安装。勿使用 Node 20 构建 native SQLite 依赖后换 Node 22 运行。

```sh
sh reuse-eval/aipm/download-model.sh
/usr/local/bin/node search/cli.mjs status
```

模型已存在时仅校验，不下载；如果下载需要已有本地代理，为下载命令指定 CARDDESK_MODEL_PROXY。SDK 只加载已指定、已核对哈希的本地模型，不使用远程推理、生成式扩写或重排模型。

## 第一次配置某个 Vault

```sh
/usr/local/bin/node search/cli.mjs init --vault '/Users/zhangjinglin/Documents/Codex/carddesk/obsidian-plugin/test-vault' --cards ReuseWiki/wiki/aipm --cards ReuseWiki/wiki/reading
/usr/local/bin/node search/cli.mjs refresh
```

本机已经初始化，不需要重复 init。默认状态目录是项目 `.carddesk-search/`，与首轮 QMD CLI 的 `.reuse-eval/config` 和索引互相独立。换库用新的 `--state /absolute/state-folder`，状态目录必须放在 Vault 外；每条命令都要传相同 --state。init 拒绝覆盖既有配置。

允许目录用重复的 --cards；排除目录用重复的 --exclude，均为 Vault 相对目录，不含隐藏段、通配符、.. 或符号链接。不同范围不能共享一个状态目录。插件导出的允许/排除配置不自动修改这里的配置，Agent 必须先比较 status 的 vault/allowed/excluded。编辑 config.json 里的范围后须 refresh。默认忽略隐藏目录以及 QMD 自身忽略的 node_modules/vendor/dist/build。卡片最大 1 MiB。目录配置继续限制 glob 特殊字符；实际卡片名称可含英文逗号，例如 `概念,机制.md`。

## 每次使用

```sh
/usr/local/bin/node search/cli.mjs status
/usr/local/bin/node search/cli.mjs refresh
/usr/local/bin/node search/cli.mjs search --mode keyword --keywords 'Embedding' --limit 5
/usr/local/bin/node search/cli.mjs search --mode vector --question '换一个会话为什么又忘了之前的偏好？'
/usr/local/bin/node search/cli.mjs search --mode hybrid --question '找到相似卡以后就能直接建立链接吗？' --keywords '候选 关系'
/usr/local/bin/node search/cli.mjs get --path ReuseWiki/wiki/reading/retrieval.md
```

refresh 同步文本和向量；无需重建无变化的嵌入。模型权重身份保存在派生状态 embedding-model.json；首次升级或模型路径/权重哈希变化时会强制重建向量，失败后下次刷新重新构建。即使替换同一路径下的模型，也必须先更新配置的对应 SHA-256，正常 refresh 后再检索。文件新增、修改、删除、改名或范围变化后，search 返回 STALE_INDEX，不能继续拿旧结果。每次扫描并比较允许文件的完整内容哈希，候选还与实际 QMD 内容哈希比对。若 QMD 因文件大小和旧时间戳未变而漏更新，refresh 会通过公开 SDK 重建本集合并复核，返回 reindexed=true；不修改卡片时间戳。并发文件写入可能导致 FILES_CHANGED，应等 Agent 写完后再刷新；本工具不能代替文件系统快照或操作系统隔离。

get 直接读当前 Markdown，返回完整 body、sha256、indexFresh；索引旧时仍可读取允许范围的当前正文，但新召回须先 refresh。正文中的外部链接或指令不会被工具执行。读取和搜索都是只读操作。

## 显式回退

如果当前只能做关键词，可先 `refresh --keyword-only`。下次需要向量时执行正常 refresh。查询默认不回退；调用方允许时才能加：

```sh
/usr/local/bin/node search/cli.mjs search --mode hybrid --question '找到了相似的卡，能直接建立关联吗？' --keywords '候选 关系' --allow-keyword-fallback
```

输出 requestedMode=hybrid、actualMode=keyword、fallbackReason.code/message，不能当成混合成绩。缺关键词不能回退；范围、旧索引或结果映射错误也不能被回退掩盖。关键词检索不需要模型；模型失效不会破坏原文或接页阅读。

## 查询策略 v2

普通关键词用空格分隔，建议 2～6 个核心词，最多 8 个。适配层保留完整 AND 组合，并对短词分别调用 QMD BM25，再去重融合，避免某个词缺失造成整题零命中。带引号、排除词等 QMD 语法保留为一次查询，不拆散其限制条件。

每路最多 40 候选，去重后最多 60 张卡参与全文排序，最后截取 --limit（1～20）。使用 RRF（常数 60，完整组合权重 2，单词权重 1）；混合再加入权重 2 的 QMD typed vec 分支。相同可见正文和标题的查询词覆盖分别加 0.02 / 0.025 的排序分；去掉 YAML、引用元数据和链接 URL 后再计算。没有硬编码文档权限、文件名或参考答案，纯向量模式不变。

返回 strategy.version=2、查询计划和池上限；每个结果 trace 包含分支名、排名和正文/标题命中词。词汇覆盖不证明语义关系，更不执行按用户身份的文档授权。目录 allowed/excluded 是现有范围边界。分数不可跨策略比较。

宽召回会增加无答案题的候选，不能将“非空”当作可回答；先 get 全文，核对是否真正补充当前追问。策略变化不改 schemaVersion，也不需要重算既有向量；卡片改变才需 refresh。

## 返回协议

标准输出为一个 JSON，schemaVersion=1；失败 ok=false、error.code/message，并以非零状态退出。运行时诊断在 stderr。search 包括 actualMode/indexFresh/candidateOnly；results 包括 Vault 相对 path、title、score、sha256、snippet、普通 Obsidian link 和追溯用 qmdUri。片段可截断，必须 get 全文。分数不可跨模式当作统一置信度。

空数组表示本次没有候选，不保证资料全库不存在答案；非空也不保证能回答。工具不做自动拒答、事实审计或关联应用。Agent 仍须核对来源，拒绝无依据候选，按关联说明提交 proposed 建议，获准后重读两端并比较版本再应用。

错误处理：STALE_INDEX/FILES_CHANGED 先刷新；MODEL_MISSING/MODEL_INVALID 检查本地模型；VECTOR_NOT_READY 运行正常 refresh；INVALID_CONFIG/OUT_OF_SCOPE/SYMLINK/INDEX_MISMATCH 检查范围或路径，不绕开；QMD_VERSION/NODE_VERSION 按固定依赖安装；其他 QMD_FAILED 保留具体诊断。命令互斥，BUSY 不抢锁；异常退出遗留 operation.lock 时，先确认 owner.json 中进程已退出，再移走该派生锁目录。不要直接编辑数据库或 snapshot.json。

## 校验

```sh
/usr/local/bin/node --test search/tests/*.test.mjs
```

覆盖目录排除、符号链接/越界、mtime 相同的内容变化、增删改名、新鲜度与索引正文不符、模型缺失显式回退、嵌入不完整、并发锁，以及真实 QMD SDK 的中文/空格路径与 get 全文。同路径模型更换、失败重试、中文逗号文件名及恢复旧时间戳后的自动重建也有回归覆盖。GPU 集成记录见 docs/validation/search-r1/ 和 docs/validation/search-fixes/。新增中文题同语料对照见 docs/evaluation/AIPM_QUALITY_V2.md；不属于双人盲评或万卡性能交付结论。
