import {previewMarkdown} from "./preview.js";
const find = (selector) => document.querySelector(selector);
const main = find("#main");
const map = find("#map");
const search = find("#search");
let data, tab = "cards", active = null, refs = new Set(), busy = false, timer;
let revision = 0;
let includeArchived = false;
let selectedTag = "";
const relationTypes = ["支持", "补充", "反驳", "限制", "举例"];
const aiCards = () => data.cards.filter(card => card.ai_allowed && !card.archived);
const availableTags = () => [...new Set(data.cards.flatMap(card => card.tags))].sort();
const choiceList = values => values.map(value => [value, value]);

function element(tag, text, parent, options = {}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  Object.assign(node, options);
  parent?.append(node);
  return node;
}

function notify(message) {
  find("#status").textContent = message;
  clearTimeout(timer);
  timer = setTimeout(() => { find("#status").textContent = ""; }, 6000);
}

async function api(path, body, method = "POST") {
  const response = await fetch("/api/" + path, body === undefined ? {} : {
    method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === "string" ? error.detail : "请检查输入或重试。");
  }
  return response;
}

async function json(...args) {
  return (await api(...args)).json();
}

function button(parent, label, action, primary = false) {
  return element("button", label, parent, {
    type: "button", className: primary ? "primary" : "",
    onclick: async (event) => {
      if (busy) return;
      const node = event.currentTarget;
      node.disabled = true;
      try { await action(); } catch (error) { notify(error.message); }
      finally { node.disabled = false; }
    }
  });
}

function field(parent, label, options = {}, tag = "input") {
  return element(tag, null, element("label", label, parent), options);
}

function select(parent, label, choices, value) {
  const node = field(parent, label, {}, "select");
  choices.forEach(([id, title]) => element("option", title, node, {value: id}));
  if (value != null) node.value = value;
  return node;
}

async function refresh() {
  data = await json("library");
  find("#mode").textContent = data.demo ? "演示模式 · 未连接模型" : "模型已配置";
}

function renderList() {
  const list = find("#list");
  list.replaceChildren();
  find("#searchbox").hidden = tab !== "cards";
  document.querySelectorAll("[data-tab]").forEach(node => {
    node.setAttribute("aria-pressed", String(node.dataset.tab === tab));
  });
  const add = find("#new");
  add.hidden = tab === "drafts";
  add.textContent = {cards:"新建卡片", sources:"粘贴素材", chats:"新对话",topics:"新建主题"}[tab] || "";
  const query = search.value.trim().toLocaleLowerCase();
  const filters = find("#card-filters");
  filters.replaceChildren();
  if (tab === "cards") {
    const tag = select(filters, "标签", [["", "全部标签"], ...choiceList(availableTags())], selectedTag);
    tag.onchange = () => { selectedTag = tag.value; renderList(); };
    const archived = checkbox(filters, "显示已归档卡片", includeArchived);
    archived.onchange = () => { includeArchived = archived.checked; renderList(); };
  }
  const items = data[tab].filter(item => tab !== "cards" || (
    (includeArchived || !item.archived) && (!selectedTag || item.tags.includes(selectedTag)) &&
    (item.title + "\n" + item.body + "\n" + item.tags.join(" ")).toLocaleLowerCase().includes(query)
  ));
  if (!items.length) element("p", query && tab === "cards" ? "没有匹配卡片" : "这里还没有内容", list, {className:"muted"});
  items.forEach(item => {
    const node = button(list, item.title + (item.archived ? "（已归档）" : ""), () => open(tab, item.id));
    if (item.id === active) node.classList.add("selected");
  });
}

async function open(next, id = null, reference = null, messageId = null) {
  if (busy) return;
  const token = ++revision;
  tab = next;
  active = id;
  renderList();
  main.replaceChildren();
  map.replaceChildren();
  element("h2", "卡片关系", map);
  if (next !== "cards" || !id) element("p", "打开一张已保存的卡片，查看它的直接关联。", map, {className:"muted"});
  if (next === "cards") {
    const card = id ? await json("cards/" + id) : {};
    if (token !== revision) return;
    renderCard(card);
  } else if (next === "sources") {
    renderSource(data.sources.find(item => item.id === id));
  } else if (next === "topics") {
    const topic = id ? await json("topics/" + id) : {};
    if (token === revision) renderTopic(topic);
  } else if (next === "drafts") {
    const draft = data.drafts.find(item => item.id === id);
    if (draft) renderDraft(draft);
    else element("h1", "待审核的卡片", main);
  } else {
    const chat = id ? await json("chats/" + id) : {messages:[]};
    if (token !== revision) return;
    const allowed = new Set(aiCards().map(card => card.id));
    refs = new Set((reference != null ? [reference] : chat.messages.at(-1)?.refs || []).filter(id => allowed.has(id)));
    renderChat(chat, messageId);
  }
}

function editor(item, parent) {
  const title = field(parent, "标题", {value:item.title || "", maxLength:200});
  const kind = select(parent, "类型", [["观点","观点"],["问题","问题"]], item.kind);
  const body = field(parent, "正文（Markdown）", {value:item.body || "", rows:9}, "textarea");
  body.maxLength = 50000;
  const preview = element("section", null, parent, {className:"markdown", hidden:true});
  button(parent, "预览正文", async () => {
    preview.hidden = false;
    await previewMarkdown(preview, body.value, json);
  });
  return () => ({title:title.value, kind:kind.value, body:body.value});
}

function showOrigin(item, parent) {
  if (!item.excerpt) return;
  const details = element("details", null, parent, {open:true});
  element("summary", item.inference ? "来源片段 · AI 推断" : "来源片段", details);
  element("p", item.excerpt, details, {className:"quote"});
  const source = item.source || data.sources.find(source => source.id === item.source_id);
  if (source) {
    if (/^https?:\/\//i.test(source.url)) {
      element("a", source.title, details, {href:source.url,target:"_blank",rel:"noopener noreferrer"});
    }
    button(details, "查看素材原文", () => open("sources", item.source_id));
  }
  if (item.message_id) button(details, "回到对话消息", async () => {
    const message = await json("messages/" + item.message_id);
    await open("chats", message.chat_id, null, message.id);
  });
}

function renderCard(card) {
  element("h1", card.title || "新建卡片", main);
  const reading = element("article", null, main, {className:"markdown",hidden:!card.id});
  if (card.id) void previewMarkdown(reading, card.body, json).catch(error => {
    reading.textContent = card.body;
    notify(error.message);
  });
  const actions = element("div", null, main, {className:"actions"});
  const editing = element("section", null, main, {hidden:!!card.id});
  const values = editor(card, editing);
  if (card.id) {
    const edit = button(actions, "编辑卡片", () => {
      editing.hidden = !editing.hidden;
      reading.hidden = !editing.hidden;
      edit.textContent = editing.hidden ? "编辑卡片" : "返回阅读";
      if (!editing.hidden) editing.querySelector("input").focus();
    });
  }
  button(editing, "保存卡片", async () => {
    const result = await json(card.id ? "cards/" + card.id : "cards", values(), card.id ? "PUT" : "POST");
    await refresh();
    await open("cards", result.id);
    notify("卡片已保存");
  }, true);
  if (!card.id) return;
  if (card.ai_allowed && !card.archived) button(actions, "围绕这张卡提问", () => open("chats", null, card.id));
  if (card.tags.length) element("p", card.tags.map(tag => "#" + tag).join("  "), main, {className:"muted"});
  if (card.merged_into) button(main, "查看合并后的卡片", () => open("cards", card.merged_into));
  else renderCardSettings(card);
  if (card.merged_sources.length) {
    const history = element("details", null, main);
    element("summary", "合并记录与原始来源", history);
    for (const old of card.merged_sources) {
      button(history, old.title, () => open("cards", old.id));
      showOrigin(old, history);
    }
  }
  showOrigin(card, main);
  renderGraph(card);
  const expansions = element("div", null, map, {className:"edge-list"});
  button(map, "展开两层邻居", async () => {
    const graph = await json("graph");
    const near = new Set([card.id, ...card.edges.map(edge => edge.neighbor)]);
    const twoHops = new Set(near);
    graph.edges.forEach(edge => {
      if (near.has(edge.origin)) twoHops.add(edge.target);
      if (near.has(edge.target)) twoHops.add(edge.origin);
    });
    expansions.replaceChildren();
    drawNetwork(expansions, graph.cards.filter(item => twoHops.has(item.id)),
      graph.edges.filter(edge => twoHops.has(edge.origin) && twoHops.has(edge.target)));
  });
  const options = data.cards.filter(item => item.id !== card.id && !item.archived).map(item => [item.id, item.title]);
  if (!options.length) return;
  const form = element("details", null, map);
  element("summary", "连接另一张卡", form);
  const suggestion = card.suggestion;
  const linked = suggestion && card.edges.some(edge => edge.origin === card.id && edge.target === suggestion.target);
  if (suggestion && !linked) {
    form.open = true;
    element("p", "AI 建议｜" + suggestion.reason, form, {className:"muted"});
  }
  const target = select(form, "新卡指向", options, suggestion && !linked ? suggestion.target : null);
  const kind = select(form, "关系", ["补充","支持","反驳","限制","举例"].map(value => [value,value]));
  const reason = field(form, "为什么相连", {value:suggestion && !linked ? suggestion.reason : "", maxLength:500}, "textarea");
  button(form, "确认连线", async () => {
    await json("links", {origin:card.id,target:Number(target.value),kind:kind.value,reason:reason.value});
    await open("cards", card.id);
    notify("关系已保存");
  }, true);
}

function svgNode(tag, attrs, parent) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

function renderGraph(card) {
  const neighbors = [...new Map(card.edges.map(edge => [edge.neighbor, edge])).values()];
  const height = Math.max(230, neighbors.length * 25);
  const svg = svgNode("svg", {viewBox:`0 0 280 ${height}`, "aria-label":"局部关系图"}, map);
  const center = height / 2;
  const positions = new Map(neighbors.map((edge, index) => {
    const angle = index * 2 * Math.PI / neighbors.length - Math.PI / 2;
    return [edge.neighbor, [140 + 94 * Math.cos(angle), center + (center - 35) * Math.sin(angle)]];
  }));
  const info = element("p", card.edges.length ? "点击连线查看关系说明。" : "这张卡还没有连线。", map, {className:"muted"});
  function explain(edge) {
    info.textContent = (edge.origin === card.id ? "当前卡 → " + edge.title : edge.title + " → 当前卡")
      + "｜" + edge.kind + "｜" + edge.reason;
  }
  for (const edge of neighbors) {
    const [x,y] = positions.get(edge.neighbor);
    svgNode("line", {x1:140,y1:center,x2:x,y2:y,stroke:"#abc1d1","stroke-width":2}, svg);
    const hit = svgNode("line", {x1:140,y1:center,x2:x,y2:y,stroke:"transparent","stroke-width":16}, svg);
    hit.style.cursor = "pointer";
    hit.onclick = () => explain(edge);
  }
  function dot(x,y,title,isCenter,action) {
    const group = svgNode("g", action ? {role:"button",tabindex:0,"aria-label":title} : {}, svg);
    svgNode("circle", {cx:x,cy:y,r:isCenter?16:10,fill:isCenter?"#213e69":"#8bcbb9",stroke:"#213e69"}, group);
    svgNode("text", {x,y:y+30,"text-anchor":"middle"}, group).textContent = title.length > 9 ? title.slice(0,9)+"…" : title;
    if (action) {
      group.onclick = () => action().catch(error => notify(error.message));
      group.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          group.onclick();
        }
      };
    }
  }
  dot(140,center,card.title,true);
  for (const edge of neighbors) dot(...positions.get(edge.neighbor),edge.title,false,()=>open("cards",edge.neighbor));
  const list = element("div", null, map, {className:"edge-list"});
  card.edges.forEach(edge => button(list, edge.kind + " · " + edge.title, () => explain(edge)));
}

async function makeDraft(kind, id, excerpt = "") {
  const result = await json("drafts", {kind,id,excerpt});
  await refresh();
  await open("drafts", result.id);
}

function renderSource(item) {
  element("h1", item?.title || "收集素材", main);
  if (item) {
    if (/^https?:\/\//i.test(item.url)) element("a", "打开来源链接", main, {href:item.url,target:"_blank",rel:"noopener noreferrer"});
    else if (item.url) element("p", item.url, main);
    const body = element("p", item.body, main, {className:"quote"});
    const derived = data.cards.filter(card => card.source_id === item.id);
    const pending = data.drafts.filter(draft => draft.source_id === item.id);
    element("p", derived.length ? "已制卡" : pending.length ? "待审核" : "待处理", main, {className:"muted"});
    const links = element("div", null, main, {className:"actions"});
    derived.forEach(card => button(links, card.title, () => open("cards", card.id)));
    pending.forEach(draft => button(links, "待审核 · " + draft.title, () => open("drafts", draft.id)));
    draftButton(main, body, "sources", item.id);
    return;
  }
  const title = field(main, "标题");
  const url = field(main, "来源链接（可选）");
  const body = field(main, "粘贴摘录", {rows:10}, "textarea");
  const file = field(main, "导入 Markdown 文件", {type:"file",accept:".md,.markdown,.txt"});
  file.onchange = async () => {
    try {
      const selected = file.files[0];
      if (!selected) return;
      if (selected.size > 200000) throw new Error("文件过大，请拆分后导入");
      const contents = await selected.text();
      if (contents.length > 50000) throw new Error("正文最多 50,000 字，请拆分后导入");
      if (file.isConnected) {
        title.value = selected.name.replace(/\.[^.]+$/, "").slice(0, 200);
        body.value = contents;
      }
    } catch (error) { notify(error.message); }
  };
  button(main, "提取网页正文", async () => {
    const page = await json("sources/extract", {url:url.value.trim()});
    title.value = page.title;
    body.value = page.body;
    notify("已提取正文，核对后可保存");
  });
  button(main, "保存素材", async () => {
    const saved = await json("sources", {title:title.value,body:body.value,url:url.value});
    await refresh();
    await open("sources", saved.id);
  }, true);
}

function draftButton(parent, body, kind, id) {
  let excerpt = "";
  const control = button(parent, "生成候选卡", () => makeDraft(kind,id,excerpt));
  const remember = () => {
    const selection = window.getSelection();
    excerpt = body.contains(selection.anchorNode) && body.contains(selection.focusNode) ? selection.toString() : "";
    control.textContent = excerpt.trim() ? "从选中片段制卡" : "生成候选卡";
    if (!excerpt.trim()) excerpt = "";
  };
  body.addEventListener("pointerup", remember);
  body.addEventListener("keyup", remember);
}

function renderDraft(draft) {
  element("h1", "审核候选卡", main);
  showOrigin(draft, main);
  const values = editor(draft, main);
  const similar = element("div", null, main, {className:"actions"});
  async function findSimilar() {
    const {title} = values();
    const cards = await json("similar", {query:title.trim()});
    similar.replaceChildren();
    if (cards.length) element("p", "可能相似的卡片", similar, {className:"muted"});
    cards.forEach(card => button(similar, card.title, () => open("cards", card.id)));
  }
  button(main, "查找相似卡片", findSimilar);
  void findSimilar().catch(() => {});
  const actions = element("div", null, main, {className:"actions"});
  button(actions, "采纳为卡片", async () => {
    const saved = await json(`drafts/${draft.id}/accept`, values());
    await refresh();
    await open("cards", saved.id);
  }, true);
  button(actions, "丢弃草稿", async () => {
    await json(`drafts/${draft.id}/discard`, {});
    await refresh();
    await open("drafts");
  });
}

function renderChat(chat, jump) {
  element("h1", chat.title || "与 AI 对话", main);
  const thread = element("div", null, main);
  chat.messages.forEach(message => {
    const block = element("article", null, thread, {id:"message-"+message.id});
    element("strong", message.role === "user" ? "你" : "AI", block);
    const body = element("p", message.body, block, {className:"message "+message.role});
    const actions = element("div", null, block, {className:"actions"});
    message.refs.forEach(id => {
      const card = data.cards.find(item => item.id === id);
      if (card) button(actions, "参考｜"+card.title, () => open("cards",id));
    });
    message.cards.forEach(card => button(actions, "已保存｜" + card.title, () => open("cards", card.id)));
    if (message.role === "assistant") draftButton(actions, body, "messages", message.id);
  });
  element("h2", "本轮参考卡", main);
  const referenceList = element("div", null, main, {className:"references"});
  if (!aiCards().length) element("p", "卡库里暂无可供 AI 引用的卡片。", referenceList, {className:"muted"});
  aiCards().forEach(card => {
    const label = element("label", null, referenceList);
    const checkbox = element("input", null, label, {type:"checkbox",checked:refs.has(card.id)});
    label.append(card.title);
    checkbox.onchange = () => {
      if (checkbox.checked && refs.size === 8) {
        checkbox.checked = false;
        notify("每轮最多选 8 张卡片");
      } else if (checkbox.checked) refs.add(card.id);
      else refs.delete(card.id);
    };
  });
  const input = field(main, "你的问题", {rows:3,placeholder:"从一个值得追问的问题开始",maxLength:8000}, "textarea");
  button(main, "从卡库找参考卡", async () => {
    const result = await json("search", {query:input.value.trim()});
    const picks = result.cards.slice(0, 8);
    if (!picks.length) { notify("没有找到相关卡片"); return; }
    refs = new Set(picks.map(card => card.id));
    referenceList.querySelectorAll("input").forEach((control, index) => {
      control.checked = refs.has(aiCards()[index].id);
    });
    notify(result.semantic ? "已选中相关卡片，可在发送前调整" : "已按关键词选中卡片，可在发送前调整");
  });
  button(main, "发送问题", async () => {
    if (!input.value.trim()) { input.focus(); return; }
    busy = true;
    let chatId = chat.id;
    const question = input.value.trim();
    element("p", question, thread, {className:"message user"});
    const answer = element("p", "正在等待回复…", thread, {className:"message"});
    let complete = false, started = false;
    try {
      const response = await api("chat", {chat_id:chatId,question,refs:[...refs]});
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const {value,done} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value,{stream:true});
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          const part = JSON.parse(line);
          if (part.chat_id) chatId = part.chat_id;
          if (part.error) throw new Error(part.error);
          if (part.delta) {
            if (!started) answer.textContent = "";
            answer.textContent += part.delta;
            started = true;
          }
          if (part.message_id) complete = true;
        }
      }
      if (!complete) throw new Error("回复未完整保存，请重试。");
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      await refresh();
      await open("chats", chatId || null);
      if (!complete) main.querySelector("textarea").value = question;
    }
  }, true);
  if (jump) requestAnimationFrame(() => document.getElementById("message-"+jump)?.scrollIntoView({block:"center"}));
}

const modelDialog = find("#model-dialog");
const modelForm = find("#model-form");
const modelFields = modelForm.elements;
const modelResult = find("#model-result");
let modelPending = false;

function showModel(config) {
  modelFields.enabled.checked = config.enabled;
  modelFields.base_url.value = config.base_url;
  modelFields.model.value = config.model;
  modelFields.api_key.value = "";
  modelFields.clear_key.checked = false;
  find("#key-info").textContent = config.has_key
    ? "已有密钥。接口地址不变时，留空会沿用已保存的密钥。"
    : "无需密钥的本机接口可留空。";
}

async function submitModel(test) {
  if (modelPending || !modelForm.reportValidity()) return;
  const payload = {
    enabled: modelFields.enabled.checked,
    base_url: modelFields.base_url.value,
    model: modelFields.model.value,
    api_key: modelFields.api_key.value,
    clear_key: modelFields.clear_key.checked
  };
  modelPending = true;
  const controls = [...modelFields];
  controls.forEach(node => { node.disabled = true; });
  modelResult.textContent = test ? "正在请求模型…" : "正在保存…";
  try {
    if (test) {
      await json("settings/model/test", payload);
      modelResult.textContent = "连接成功，已收到模型回复。";
    } else {
      const config = await json("settings/model", payload, "PUT");
      showModel(config);
      find("#mode").textContent = config.enabled ? "模型已配置" : "演示模式 · 未连接模型";
      modelResult.textContent = "设置已保存，下次请求使用新配置。";
    }
  } catch (error) {
    modelResult.textContent = error.message;
  } finally {
    controls.forEach(node => { node.disabled = false; });
    modelPending = false;
  }
}

find("#model-settings").onclick = async () => {
  try {
    showModel(await json("settings/model"));
    modelResult.textContent = "";
    modelDialog.showModal();
  } catch (error) {
    notify(error.message);
  }
};
modelForm.onsubmit = event => {
  event.preventDefault();
  void submitModel(false);
};
find("#test-model").onclick = () => submitModel(true);
find("#close-model").onclick = () => modelDialog.close();
modelDialog.oncancel = event => { if (modelPending) event.preventDefault(); };
modelDialog.onclose = () => { modelFields.api_key.value = ""; };

document.querySelectorAll("[data-tab]").forEach(node => {
  node.onclick = () => {
    const next = node.dataset.tab;
    open(next, (next === "cards" ? data.cards.find(card => !card.archived) : data[next][0])?.id ?? null).catch(error => notify(error.message));
  };
});
find("#new").onclick = () => open(tab).catch(error => notify(error.message));
search.oninput = renderList;
try {
  await refresh();
  await open("cards", data.cards.find(card => !card.archived)?.id ?? null);
} catch (error) {
  notify(error.message);
}

function checkbox(parent, title, checked) {
  const label = element("label", null, parent, {className:"check"});
  const input = element("input", null, label, {type:"checkbox", checked});
  label.append(title);
  return input;
}

function renderCardSettings(card) {
  const settings = element("details", null, main);
  element("summary", "标签、归档和 AI 检索", settings);
  const tags = field(settings, "标签（用逗号分隔）", {value:card.tags.join(", ")});
  const archived = checkbox(settings, "归档卡片", !!card.archived);
  const allowed = checkbox(settings, "允许 AI 检索和引用", !!card.ai_allowed);
  button(settings, "保存卡片设置", async () => {
    await json("cards/" + card.id + "/settings", {
      tags:tags.value.split(/[,，]/), archived:archived.checked, ai_allowed:allowed.checked
    }, "PATCH");
    await refresh();
    await open("cards", card.id);
  });
  const others = data.cards.filter(item => item.id !== card.id && !item.archived);
  if (card.archived || !others.length) return;
  const source = select(settings, "将另一张卡合并到当前卡", [["","选择卡片"], ...others.map(item => [item.id,item.title])]);
  button(settings, "合并卡片", async () => {
    if (!source.value) return;
    const name = others.find(item => item.id === Number(source.value)).title;
    if (!window.confirm("将「" + name + "」的正文和关系合并到当前卡片？")) return;
    await json("cards/" + card.id + "/merge", {source:Number(source.value)});
    await refresh();
    await open("cards", card.id);
    notify("卡片已合并");
  });
}

function renderTopic(topic) {
  element("h1", topic.title || "新建主题", main);
  const title = field(main, "主题名称", {value:topic.title || "",maxLength:200});
  const question = field(main, "要回答的问题", {value:topic.question || "",maxLength:8000});
  const pathway = element("ol", null, main);
  const ids = [...(topic.card_ids || [])];
  const text = field(main, "主题笔记或写作提纲", {value:topic.body || "",rows:10,maxLength:50000}, "textarea");
  const picker = select(main, "添加卡片", [["","选择卡片"], ...data.cards.filter(card => !card.archived).map(card => [card.id,card.title])]);
  const preview = element("div", null, main, {className:"markdown"});
  function showPath() {
    pathway.replaceChildren();
    ids.forEach((id, index) => {
      const card = data.cards.find(item => item.id === id);
      const row = element("li", null, pathway);
      button(row, card?.title || "卡片 #" + id, () => open("cards", id));
      if (index) button(row, "上移", () => {
        [ids[index-1], ids[index]] = [ids[index], ids[index-1]];
        showPath();
      });
      button(row, "移除", () => { ids.splice(index, 1); showPath(); });
    });
  }
  showPath();
  button(main, "加入阅读路径", () => {
    const id = Number(picker.value);
    if (id && !ids.includes(id)) { ids.push(id); showPath(); }
  });
  button(main, "推荐阅读路径", async () => {
    const result = await json("search", {query:question.value.trim()});
    for (const card of result.cards) if (!ids.includes(card.id)) ids.push(card.id);
    showPath();
    notify(result.cards.length ? "已将推荐加入阅读路径" : "没有找到相关卡片");
  });
  button(main, "生成引用提纲", async () => {
    if (!ids.length) { notify("请先加入相关卡片"); return; }
    const result = await json("outline", {query:question.value.trim() || title.value.trim(), card_ids:ids});
    const next = (text.value ? text.value + "\n\n" : "") + result.body;
    if (next.length > 50000) { notify("提纲超出正文上限"); return; }
    text.value = next;
  });
  button(main, "预览正文", () => previewMarkdown(preview, text.value, json));
  button(main, "保存主题", async () => {
    const saved = await json(topic.id ? "topics/" + topic.id : "topics", {
      title:title.value, question:question.value, body:text.value, card_ids:ids
    }, topic.id ? "PUT" : "POST");
    await refresh();
    await open("topics", saved.id);
  }, true);
}

function drawNetwork(parent, cards, edges) {
  if (!cards.length) { element("p", "没有匹配卡片", parent); return; }
  const height = Math.max(240, cards.length * 27);
  const graph = svgNode("svg", {viewBox:`0 0 520 ${height}`, "aria-label":"卡片关系图"}, parent);
  const points = new Map(cards.map((card, index) => {
    const angle = 2 * Math.PI * index / cards.length;
    return [card.id, [260 + Math.cos(angle) * 192, height / 2 + Math.sin(angle) * (height / 2 - 32)]];
  }));
  for (const edge of edges) {
    const [x1,y1] = points.get(edge.origin);
    const [x2,y2] = points.get(edge.target);
    const line = svgNode("line", {x1,y1,x2,y2,stroke:"#8ba6be","stroke-width":2}, graph);
    svgNode("title", {}, line).textContent = edge.kind + " · " + edge.reason;
  }
  for (const card of cards) {
    const [x,y] = points.get(card.id);
    const link = svgNode("g", {role:"button",tabindex:0,"aria-label":card.title}, graph);
    svgNode("circle", {cx:x,cy:y,r:8,fill:"#213e69"}, link);
    svgNode("text", {x,y:y+21,"text-anchor":"middle"}, link).textContent = card.title.slice(0, 14);
    link.onclick = () => open("cards", card.id).catch(error => notify(error.message));
    link.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        link.onclick();
      }
    };
  }
}

function extraView(title) {
  ++revision;
  main.replaceChildren();
  map.replaceChildren();
  element("h1", title, main);
}

async function globalGraph() {
  if (busy) return;
  extraView("全局图谱");
  const tag = select(main, "标签", [["","全部标签"], ...choiceList(availableTags())]);
  const kind = select(main, "关系类型", [["","全部关系"], ...choiceList(relationTypes)]);
  const display = element("div", null, main);
  async function update() {
    const graph = await json("graph?" + new URLSearchParams({tag:tag.value,kind:kind.value}));
    if (!display.isConnected) return;
    display.replaceChildren();
    element("p", `${graph.cards.length} 张卡片，${graph.groups.length} 个关联群组`, display);
    const cards = new Map(graph.cards.map(card => [card.id,card]));
    graph.groups.forEach((group,index) => {
      const section = element("details", null, display, {open:index === 0});
      element("summary", group.label + " · " + group.ids.length + " 张卡片", section);
      const ids = new Set(group.ids);
      drawNetwork(section, group.ids.map(id => cards.get(id)),
        graph.edges.filter(edge => ids.has(edge.origin) && ids.has(edge.target)));
    });
  }
  tag.onchange = kind.onchange = () => update().catch(error => notify(error.message));
  await update();
}

function dataTools() {
  if (busy) return;
  extraView("备份与恢复");
  element("p", "备份包含卡片、素材、对话、候选卡、关系和主题。模型配置与密钥单独保存在本机。", main);
  element("a", "下载知识库备份", main, {href:"/api/backup"});
  const file = field(main, "选择备份文件", {type:"file",accept:".json,application/json"});
  button(main, "恢复备份", async () => {
    if (!file.files.length) { notify("请选择备份文件"); return; }
    if (file.files[0].size > 25000000) { notify("备份超过 25 MB"); return; }
    if (!window.confirm("恢复会替换当前知识库。确认使用选中的备份？")) return;
    const response = await fetch("/api/restore", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:file.files[0]
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.detail || "恢复失败");
    }
    await refresh();
    await open("cards", data.cards.find(card => !card.archived)?.id);
    notify("备份已恢复");
  });
}

find("#global-graph").onclick = () => globalGraph().catch(error => notify(error.message));
find("#data-tools").onclick = dataTools;
