# 接页 Carddesk 0.3.4（预发布测试版）

将 Markdown 内链放在同一阅读视图中逐层展开，支持多分支、共享卡独立实例、收起/返回上层，以及阅读路径自动保存、命名保存与恢复。

本版包含三份可导出的 Agent 说明、只读卡片包校验，以及基于 QMD 2.9.0 的本地关键词/向量/混合检索工具。插件本身不接生成 API、不运行 Agent。三份说明统一为 instruction_version=3。

## 下载哪一个

- **carddesk-plugin-0.3.4.zip**：Obsidian 插件。解压后把 carddesk 文件夹放入目标库 `.obsidian/plugins/`，重启 Obsidian 并在第三方插件设置里手动启用。升级只替换 main.js、manifest.json、styles.css，保留 data.json。
- **carddesk-tools-0.3.4.zip**：独立检索工具。解压后按 README 安装 Node 22+ 和私有依赖，另外准备本地模型；插件阅读不需要这个组件。
- **carddesk-example-vault-0.3.4.zip**：原创示例库。解压并作为已有库打开，手动启用插件后从 P0/A 或 P4/Cards/入口体验。示例未预先启用插件，不带个人阅读状态。

完整操作及回退说明见附件 **INSTALL.md**；已知限制见 **KNOWN_LIMITATIONS.md**。**MODEL.json** 提供模型官方地址与固定哈希，权重不在附件中。

下载全部附件到同一目录后，运行 `python3 verify-release.py`，按 **SHA256SUMS.json** 验证文件和 ZIP 成员内容。

## 安装检索工具

在解压后的工具目录执行（将 Node 路径换成本机 Node 22+）：

```sh
CARDDESK_NODE=/usr/local/bin/node sh release/setup-search.sh
sh reuse-eval/aipm/download-model.sh
```

初始化时指定实际 Vault 的绝对路径、允许卡片目录和 Vault 外的状态目录，按工具 README 执行 init、refresh、search 和 get。模型已预装时可显式指定其绝对路径与 SHA-256，避免重复下载。依赖与模型准备完后可离线运行，Obsidian 不必同时启动。

## 已知限制

- 实际验证环境为 macOS / Obsidian 1.9.14，其他平台、移动端、更多窗口尺寸和社区市场安装尚未验证。
- 首次安装依赖与获取模型需要联网；包不包含约 639 MB 的嵌入模型、node_modules 或预建个人索引。
- 检索候选不是事实或关联结论；混合检索不保证全面优于关键词，材料外问题也可能返回候选。Agent 必须读全文，缺依据时拒绝回答或加链。
- 没有自动后台刷新或按用户身份的权限服务，只有允许/排除目录范围；数据变化需显式 refresh，失败回退必须查看 actualMode。
- 进一步混合优化、独立材料/第二评审、千卡/万卡性能测试暂缓，不能视为已经通过。

验证覆盖 33 项工程测试，以及独立环境安装、禁网检索、缺模型回退、损坏索引重建和命名路径重启恢复；这不等于独立质量或大规模性能认证。

本 Release 不上传用户书籍/PDF、私人笔记、个人状态、材料评测数据/报告、决策日志、密钥、模型或缓存。

发布附件使用 ASCII 文件名，避免平台重命名影响校验。`v0.3.4` 标签保持指向原程序源码；附件仅修正发布命名与说明，SHA256SUMS.json 分别记录 sourceCommit 与 packagingCommit，插件二进制不变。
