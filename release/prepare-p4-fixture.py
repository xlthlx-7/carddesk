from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parent.parent;v=ROOT/'obsidian-plugin/test-vault';out=ROOT/'docs/validation/p4'
exports=['Carddesk/Agent拆卡说明.v3-1.md','Carddesk/Agent关联检查说明.v3-2.md','Carddesk/Agent检索说明.v3-1.md']
for n in exports:
 text=(v/n).read_text();assert 'instruction_version: 3' in text and 'P4/Cards,Cards/P3' in text and 'instruction_version: 2' not in text
source=v/'P4/Sources/交付说明.md';assert source.exists()
cards=[('入口','entry','接页的组件边界：读卡、检索与状态','插件安装 / 检索工具安装 / 从 Agent 到阅读','接页把可阅读的知识卡、探索时展开的分支和用于召回的索引分开保存。卡片是普通笔记，内链表达正式关系；一次阅读路径记录这次如何展开，不会替代卡片正文。读卡不要求嵌入模型在线，也不要求启动检索工具，已有解释可以沿链接继续阅读。\n\n如果想知道没有模型时还能做什么，展开[离线与回退](离线与回退.md)；如果担心升级后路径丢失，展开[数据保护](数据保护.md)。阅读时可以同时展开两条分支，再收起其中一条；需要下次继续的结构可命名保存。边界说明应当能回到实际材料核对，不能因为界面里能打开链接，就认定资料已经得到事实验证。本组是交付流程的隔离演练，不是独立质量评测。'),('离线与回退','explanation','离线与回退：阅读不依赖检索模型','检索工具安装','离线有两种不同场景。已有 Markdown 卡片和内链可在阅读器里直接打开，不需要检索模型；要做语义检索，则应预先安装依赖与经过校验的本地嵌入模型。准备完成后，模型计算在本机进行，Obsidian 本身也不必同时运行。首次安装依赖或获取模型所需的联网，不应被混称为查询时上传资料。\n\n缺少模型时，关键词检索仍可能可用，但它不能冒充完成了向量或混合查询。调用方需要明确允许回退，并核对返回的实际模式；没有可用索引时，应先准备索引或明确说明无法检索。可回到[组件边界](入口.md)理解阅读和检索的区别；缓存、卡片和路径如何保留，再看[数据保护](数据保护.md)。'),('数据保护','explanation','数据保护：更新程序不覆盖阅读状态','插件安装 / 回退与卸载','插件程序与阅读状态是不同的文件。升级前先备份，更新程序时保留已有阅读数据；卡片和原文也应保持为可以独立阅读的笔记。导出的说明如果经过用户编辑，后续导出应另存版本，而不是把人的修改悄悄抹掉。是否安装成功，还要通过实际打开、保存和恢复验证。\n\n检索索引属于可重建的派生数据，损坏时先停止使用并备份，再按说明重建，不能把原文与卡片一并删除。模型若由多个工具共用，也不应在卸载某个工具时误删。理解[离线与回退](离线与回退.md)有助于区分模型缺失与阅读失败；在[组件边界](入口.md)可以重新选择本次需要深入的分支。')]
for name,role,title,locator,body in cards:
 p=v/'P4/Cards'/f'{name}.md';assert not p.exists();p.write_text(f'---\ncarddesk_schema: 1\ncard_id: p4-delivery-{role if role=="entry" else name}\ncard_role: {role}\nsource_path: P4/Sources/交付说明.md\nsource_locator: {locator}\n---\n# {title}\n\n{body}\n')
m={'schemaVersion':1,'packageId':'p4-delivery-workflow','title':'P4 交付流程演练','entry':'P4/Cards/入口.md','files':[f'P4/Cards/{x[0]}.md' for x in cards],'sources':['P4/Sources/交付说明.md','Sources/P3/渐进阅读示例.md']}
p=v/'Carddesk/packages/p4-delivery.json';assert not p.exists();p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
(out/'agent-workflow-input.json').write_text(json.dumps({'agent':'Current Codex session; no new external agent or AI API','task':'P4 file-protocol smoke workflow, not independent quality assessment','instructions':{n:hashlib.sha256((v/n).read_bytes()).hexdigest() for n in exports},'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'newCards':m['files'],'existingCardsModified':[]},ensure_ascii=False,indent=2)+'\n')
print('Prepared 3 original delivery cards under P4 only; existing knowledge untouched')
