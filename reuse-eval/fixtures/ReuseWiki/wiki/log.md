# Wiki log

## 2026-11-23 | seed
先建立 cognitive-load 卡，作为已存在的知识。

## 2026-11-23 | ingest | raw/reading/lecture.md
本次 Codex 会话读取隔离安装的 karpathy-llm-wiki Skill 并执行其流程；不是调用额外 Agent 子进程。
先用 QMD search 认知负担查到旧卡，再用 QMD get 阅读其全文。
New: entry、provenance、retrieval、relations、maintenance。
Existing: cognitive-load 与新讲义认知负担段落表达同一原则，没有实质新增，不重复建卡。
Update: index 与本日志；raw 和已有卡保持原字节。
Disputed: 无；本次不代表冲突处理已通过测试。
接页适配：增加 YAML 元数据、入口、包清单；保留 Skill 的 Raw、Sources、Updated 和相对链接。

## 2026-11-23 | lint
使用上游 check_evidence.py 执行只读检查；结果另存于复用验证目录。
