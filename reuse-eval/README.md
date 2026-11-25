# 复用验证复跑说明

本目录保存原创中文测试讲义、Agent 加工后的卡片、QMD 调用配置与真实记录。它不是已交付的 Q1/Q2 搜索产品；主插件保持 0.3.0。

材料相关卡片、评测题集和报告仅保留本地，不在公开源码范围中。日常使用请按 [当前检索工具说明](../search/README.md) 安装与配置；下文仅描述原创示例的复跑方法。

## 已安装环境

- 上游 Skill：Astro-Han/karpathy-llm-wiki，MIT。安装在 `.reuse-eval/skills/karpathy-llm-wiki/`，本会话读取后人工应用流程。没有启动额外 Codex/Claude Code 子进程或调用生成 API。上游内容的逐文件 SHA-256 见 `results/provenance.json`，下载为 main archive，未捕获精确 commit，不能将本次结果外推到未来 main。
- QMD：`@tobilu/qmd@2.9.0`，MIT；`qmd-dependency/` 保存实际依赖锁文件。
- Node：本机 `/usr/local/bin/node` 22.19.0。QMD 要求 Node 22 或以上；默认 shell 的 Node 20 不能直接照搬。其他机器可用 `CARDDESK_QMD_NODE=/absolute/node` 指定。插件自身无需切换 Node。
- 所有 QMD 配置、SQLite 索引、模型缓存均在 `.reuse-eval/`，未改全局检索配置；不启动 MCP 或常驻服务。

## 复跑关键词检查

当前本机依赖和测试库已就绪，可直接执行：

```sh
python3 reuse-eval/probe.py
sh reuse-eval/qmd.sh status
```

脚本会临时新增一个命名固定的测试文件，验证 add/modify/delete 与显式 update，并在 finally 中清理文件和更新索引；已有同名文件时拒绝覆盖。查询结果写入 `results/lexical-probe.json` 和 `results/update-probe.json`。耗时包含进程启动，重复运行会覆盖本机本次记录。

干净环境需先将 `qmd-dependency/package.json` 与 `package-lock.json` 复制到 `.reuse-eval/qmd/`，用 Node 22+ 执行 npm ci。`qmd.sh` 只调用固定的本地安装，不做隐式下载或全局安装。然后复制 `fixtures/ReuseWiki/` 到独立测试库同名空目录，将 `fixtures/reuse-wiki.json` 放进 `Carddesk/packages/`，并注册 collection：

```sh
sh reuse-eval/qmd.sh collection add "$PWD/obsidian-plugin/test-vault/ReuseWiki/wiki/reading" --name jieye-reuse
```

不要覆盖用户已有资料。本次实际先建立旧卡、执行检索阅读全文，再由 Agent 编写五张新卡；`fixtures/` 保存的是最终结果，不是一个可以自动重新拆书的脚本。重新生成需要 Agent 按 [兼容说明](AGENT_COMPATIBILITY.md) 再执行一次，并人工检查内容。

上游 Skill 可按其仓库安装指引安装到隔离目录后审阅；本机已存在，不需要重复安装。只读证据检查：

```sh
python3 .reuse-eval/skills/karpathy-llm-wiki/scripts/check_evidence.py obsidian-plugin/test-vault/ReuseWiki
```

## 在 Obsidian 查看

打开现有独立 `obsidian-plugin/test-vault`。运行“检查 Agent 卡片包”，选择 `Carddesk/packages/reuse-wiki.json`，点击“以接页打开入口”；也可运行“继续上次阅读”。实际测试后的自动路径中保存了入口、provenance、retrieval、relations 四个节点。

入口可以分别展开来源拆分和关联检索；沿 retrieval → relations → cognitive-load 深入到复用旧卡。返回上层保留分支，收起只移除对应分支。仍使用原有 P0 布局，没有新增顶部路径栏。

本地嵌入模型的准备方式见 [检索工具说明](../search/README.md)。模型、原始运行日志和材料相关评测报告不随源码公开。
