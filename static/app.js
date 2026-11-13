import {drawConstellation} from "./constellation.js";
import {attachReferencePicker, createReadingPath} from "./reading-path.js";
import {previewMarkdown} from "./preview.js";
import {demoRequest} from "./demo.js";
const find = (selector) => document.querySelector(selector);
const staticDemo = document.documentElement.dataset.staticDemo === "true";
if (staticDemo) {
  for (const selector of ["#inbox-tab", "#model-settings", "#data-tools", "#trash", "#chat-toggle"]) {
    find(selector).hidden = true;
  }
}
const main = find("#main");
const map = find("#map");
const chatPanel = find("#chat-panel");
const chatToggle = find("#chat-toggle");
let chatRevision = 0;
let chatPending = false;
let chatInitialized = false;
const search = find("#search");
const searchBox = search.closest("label");
let data, tab = "home", active = null, timer;
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
  if (staticDemo) return demoRequest(...args);
  return (await api(...args)).json();
}

function button(parent, label, action, primary = false) {
  return element("button", label, parent, {
    type: "button", className: primary ? "primary" : "",
    onclick: async (event) => {
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

const readingKey = "carddesk.last-reading";

function lastReading() {
  try { return JSON.parse(localStorage.getItem(readingKey)) || null; }
  catch { return null; }
}

function rememberReading(id, entries) {
  try { localStorage.setItem(readingKey, JSON.stringify({id, entries})); }
  catch { /* Reading still works without browser storage. */ }
}

function renderHome() {
  const layout = element("div", null, main, {className:"graph-home"});
  const graph = element("section", null, layout);

  const home = element("aside", null, layout, {className:"home-tools"});
  const preview = element("section", null, home, {className:"home-section",hidden:true});
  void renderGlobalGraph(graph, preview);
  const form = element("form", null, home, {className:"home-search"});
  const input = field(form, "搜索卡片", {type:"search", placeholder:"标题、正文或标签"});
  element("button", "搜索", form, {type:"submit", className:"primary"});
  form.onsubmit = event => {
    event.preventDefault();
    search.value = input.value;
    selectedTag = "";
    cardScope = "all";
    cardLimit = 40;
    browseScroll = 0;
    browseFocus = null;
    open("cards", null, {browse:true, focusSearch:true}).catch(error => notify(error.message));
  };

  const previous = lastReading();
  const card = data.cards.find(item => item.id === previous?.id);
  if (card) {
    const section = element("section", null, home, {className:"home-section"});
    element("h2", "继续阅读", section);
    button(section, card.title, () => open("cards", card.id));
  }
  const processed = new Set([...data.cards, ...data.drafts].map(item => item.source_id));
  const pending = data.sources.filter(item => !processed.has(item.id));
  if (pending.length || data.drafts.length) {
    const section = element("section", null, home, {className:"home-section"});
    element("h2", "待整理", section);
    if (pending.length) button(section, `素材 · ${pending.length}`, () => open("sources", pending[0].id));
    if (data.drafts.length) button(section, `待审核 · ${data.drafts.length}`, () => open("drafts", data.drafts[0].id));
  }
  if (staticDemo) {
    element("p", "公开演示 · 只读快照", home, {className:"muted"});
    const index = data.cards.find(item => item.tags.includes("索引"));
    if (index) button(home, "打开学习索引", () => open("cards", index.id), true);
    return;
  }
  const actions = element("div", null, home, {className:"actions"});
  button(actions, "新建卡片", () => open("cards"), true);
  button(actions, "收集素材", () => open("sources"));
}

let cardScope = "all";
let cardLimit = 40;
let browseScroll = 0;
let browseFocus = null;
let browsingCards = false;
let recentCards = [];
try {
  const saved = JSON.parse(localStorage.getItem("carddesk.recent-cards"));
  if (Array.isArray(saved)) recentCards = saved.filter(Number.isInteger).slice(0, 40);
} catch { /* Browser storage is optional. */ }

function recordCardRead(id) {
  recentCards = [id, ...recentCards.filter(item => item !== id)].slice(0, 40);
  try { localStorage.setItem("carddesk.recent-cards", JSON.stringify(recentCards)); }
  catch { /* Browser storage is optional. */ }
}

function cardSnippet(body, query) {
  const plain = body
    .replace(/\[\[(?:#[0-9]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*`]/g, "").replace(/\s+/g, " ").trim();
  const match = query ? plain.toLocaleLowerCase().indexOf(query) : -1;
  const start = match < 0 ? 0 : Math.max(0, match - 38);
  const end = start + Math.max(150, query.length + 60);
  return (start ? "…" : "") + plain.slice(start, end) + (plain.length > end ? "…" : "");
}

function updateCardFilter() {
  cardLimit = 40;
  browseScroll = 0;
  browseFocus = null;
  if (tab === "cards" && !browsingCards) {
    void open("cards", null, {browse:true}).catch(error => notify(error.message));
  } else renderList();
}

function renderList() {
  const sidebarList = find("#list");
  sidebarList.hidden = tab === "cards";
  sidebarList.replaceChildren();
  const list = browsingCards ? find("#card-results") : sidebarList;
  list.replaceChildren();
  const catalog = find(".catalog");
  catalog.hidden = tab === "home";
  find("#inbox-views").hidden = !["sources", "drafts"].includes(tab);
  find("#inbox-sources").setAttribute("aria-pressed", String(tab === "sources"));
  find("#inbox-drafts").setAttribute("aria-pressed", String(tab === "drafts"));
  searchBox.hidden = !browsingCards;
  document.querySelectorAll("[data-tab]").forEach(node => {
    node.setAttribute("aria-pressed", String(node.dataset.tab === tab || (node.id === "inbox-tab" && tab === "drafts")));
  });
  if (tab === "home") return;
  const add = find("#new");
  add.hidden = staticDemo || tab === "drafts" || tab === "cards";
  add.textContent = {cards:"新建卡片", sources:"粘贴素材", chats:"新对话",topics:"新建主题"}[tab] || "";
  const query = search.value.trim().toLocaleLowerCase();
  const filters = find("#card-filters");
  filters.replaceChildren();
  if (tab === "cards") {
    const tag = select(filters, "标签", [["", "全部标签"], ...choiceList(availableTags())], selectedTag);
    const scopes = element("div", null, filters, {className:"actions", role:"group"});
    scopes.setAttribute("aria-label", "卡片范围");
    for (const [key, label] of [["all","全部"],["index","索引与总结"],["recent","最近阅读"]]) {
      const control = element("button", label, scopes, {type:"button"});
      control.setAttribute("aria-pressed", String(cardScope === key));
      control.onclick = () => {
        cardScope = key;
        updateCardFilter();
        filters.querySelector(`[data-scope="${key}"]`)?.focus();
      };
      control.dataset.scope = key;
    }
    tag.onchange = () => { selectedTag = tag.value; updateCardFilter(); filters.querySelector("select").focus(); };
    const archived = checkbox(filters, "显示已归档卡片", includeArchived);
    archived.onchange = () => { includeArchived = archived.checked; updateCardFilter(); filters.querySelector("input").focus(); };
  }
  if (tab === "cards" && !browsingCards) return;
  let items = data[tab].filter(item => tab !== "cards" || (
    (includeArchived || !item.archived) &&
    (cardScope !== "index" || item.tags.some(tag => ["索引", "总结"].includes(tag))) &&
    (cardScope !== "recent" || recentCards.includes(item.id)) &&
    (!selectedTag || item.tags.includes(selectedTag)) &&
    (item.title + "\n" + item.body + "\n" + item.tags.join(" ")).toLocaleLowerCase().includes(query)
  ));
  if (tab === "cards" && cardScope === "recent") {
    items.sort((a, b) => recentCards.indexOf(a.id) - recentCards.indexOf(b.id));
  }
  if (browsingCards) element("p", `${items.length} 张卡片`, list, {className:"muted"});
  if (!items.length) element("p", query && tab === "cards" ? "没有匹配卡片" : "这里还没有内容", list, {className:"muted"});
  (tab === "cards" ? items.slice(0, cardLimit) : items).forEach(item => {
    const node = button(list, item.title + (item.archived ? "（已归档）" : ""), () => open(tab, item.id));
    if (tab === "cards") node.dataset.cardId = item.id;
    if (browsingCards) {
      const title = node.textContent;
      node.textContent = "";
      node.classList.add("browse-result");
      element("strong", title, node);
      element("span", cardSnippet(item.body, query), node, {className:"browse-snippet"});
      if (item.tags.length) element("small", item.tags.map(tag => "#" + tag).join("  "), node);
    }
    if (item.id === active) node.classList.add("selected");
  });
  if (tab === "cards" && items.length > cardLimit) button(list, "显示更多", () => {
    const next = items[cardLimit].id;
    cardLimit += 40;
    renderList();
    list.querySelector(`[data-card-id="${next}"]`)?.focus();
  });
}

async function open(next, id = null, {browse = false, focusSearch = false} = {}) {
  if (browsingCards && !browse) {
    browseScroll = window.scrollY;
    browseFocus = id;
  }
  browsingCards = next === "cards" && browse;
  main.hidden = false;
  const token = ++revision;
  if (next !== "cards") setChatVisible(false);
  tab = next;
  active = id;
  main.replaceChildren();
  if (browsingCards) {
    const heading = element("div", null, main, {className:"card-heading"});
    element("h1", "卡库", heading, {id:"browse-heading",tabIndex:-1});
    if (!staticDemo) button(heading, "新建卡片", () => open("cards"), true);
    main.append(searchBox);
    element("div", null, main, {id:"card-results"});
  } else {
    find(".catalog").append(searchBox);
  }
  renderList();
  map.hidden = true;
  map.replaceChildren();
  if (next === "home") {
    renderHome();
  } else if (browsingCards) {
    const previous = find("#card-results").querySelector(`[data-card-id="${browseFocus}"]`);
    (focusSearch ? search : previous || find("#browse-heading")).focus({preventScroll:true});
    window.scrollTo(0, browseScroll);
  } else if (next === "cards") {
    const card = id ? await json("cards/" + id) : {};
    if (token !== revision) return;
    if (id && !card.deleted) {
      recordCardRead(id);
      renderList();
    }
    button(main, "返回卡片列表", () => open("cards", null, {browse:true}));
    renderCard(card, lastReading());
    window.scrollTo(0, 0);
  } else if (next === "sources") {
    renderSource(data.sources.find(item => item.id === id));
  } else if (next === "topics") {
    const topic = id ? await json("topics/" + id) : {};
    if (token === revision) renderTopic(topic);
  } else if (next === "drafts") {
    const draft = data.drafts.find(item => item.id === id);
    if (draft) renderDraft(draft);
    else element("h1", "待审核的卡片", main);
  }
}

function editor(item, parent) {
  const title = field(parent, "标题", {value:item.title || "", maxLength:200});
  const kind = select(parent, "类型", [["观点","观点"],["问题","问题"]], item.kind);
  const body = field(parent, "正文（Markdown）", {value:item.body || "", rows:9}, "textarea");
  body.maxLength = 50000;
  const choices = element("div", null, parent, {className:"actions"});
  attachReferencePicker(body, choices, () => data.cards);
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
    if (!source.deleted) button(details, "查看素材原文", () => open("sources", item.source_id));
  }
  if (item.message_id) button(details, "回到对话消息", async () => {
    const message = await json("messages/" + item.message_id);
    await showChat(message.chat_id, null, message.id);
  });
}

function renderCard(card, previous) {
  const heading = element("div", null, main, {className:"card-heading"});
  element("h1", card.title || "新建卡片", heading);
  const reading = element("div", null, main, {className:"card-reading",hidden:!card.id});
  const article = element("article", null, reading);
  if (staticDemo) {
    renderDemoCardMenu(card, heading);
    const path = createReadingPath(reading, json, () => data.cards, notify, id => open("cards", id), () => {
      if (reading.isConnected) rememberReading(card.id, path.entries());
    }, renderDemoCardMenu);
    const entries = previous?.id === card.id && Array.isArray(previous.entries) ? previous.entries : [];
    void path.restore(card, article, entries).then(() => {
      if (reading.isConnected) rememberReading(card.id, path.entries());
    }).catch(error => notify(error.message));
    return;
  }
  const editing = element("section", null, main, {hidden:!!card.id});
  const values = editor(card, editing);

  button(editing, "保存卡片", async () => {
    const result = await json(card.id ? "cards/" + card.id : "cards", values(), card.id ? "PUT" : "POST");
    await refresh();
    await open("cards", result.id);
    notify("卡片已保存");
  }, true);
  if (!card.id) return;
  if (card.deleted) {
    main.replaceChildren();
    element("h1", card.title, main);
    button(main, "从回收站恢复", () => changeTrash("cards", card.id, false));
    return;
  }

  const {action, trigger} = cardMenu(heading);
  action("编辑卡片", () => {
    editing.hidden = false;
    reading.hidden = true;
    editing.querySelector("input").focus();
  });
  button(editing, "返回阅读", () => {
    editing.hidden = true;
    reading.hidden = false;
    trigger.focus();
  });
  const save = action("保存为主题", async () => {
    const entries = path.entries();
    const saved = await json("topics", {
      title:card.title, card_ids:[...new Set(entries.map(entry => entry.card_id))], reading_path:entries
    });
    await refresh();
    await open("topics", saved.id);
    notify("阅读路径已保存");
  });
  save.hidden = true;
  const path = createReadingPath(reading, json, () => data.cards, notify, id => open("cards", id), () => {
    const entries = path.entries();
    save.hidden = entries.length < 2;
    if (reading.isConnected) rememberReading(card.id, entries);
  }, (child, heading, update) => renderChildMenu(child, heading, update));
  const entries = previous?.id === card.id && Array.isArray(previous.entries) ? previous.entries : [];
  void path.restore(card, article, entries).then(() => {
    if (!reading.isConnected) return;
    const current = path.entries();
    save.hidden = current.length < 2;
    rememberReading(card.id, current);
  });
  if (card.ai_allowed && !card.archived) action("围绕这张卡提问", () => showChat(null, card.id));
  if (card.excerpt || card.merged_sources.length) {
    action("查看来源", () => {
      showCardPanel("卡片来源", trigger);
      showOrigin(card, map);
      for (const old of card.merged_sources) {
        button(map, old.title, () => open("cards", old.id));
        showOrigin(old, map);
      }
    });
  }
  action("查看关系图谱", () => {
    showCardPanel("卡片关系", trigger);
    renderCardGraph(card);
  });
  if (card.merged_into) action("查看合并后的卡片", () => open("cards", card.merged_into));
  action("删除卡片", () => changeTrash("cards", card.id, true));
  if (!card.merged_into) action("卡片设置", () => {
    showCardPanel("卡片设置", trigger);
    renderCardSettings(card, map);
  });
}

function renderDemoCardMenu(card, heading) {
  const {action, trigger} = cardMenu(heading);
  action("查看关系图谱", async () => {
    const current = await json("cards/" + card.id);
    if (!heading.isConnected) return;
    showCardPanel("卡片关系", trigger);
    renderCardGraph(current);
  });
}

function renderChildMenu(card, heading, update) {
  const {action, trigger} = cardMenu(heading);
  action("编辑卡片", async () => {
    const current = await json("cards/" + card.id);
    if (!heading.isConnected) return;
    showCardPanel("编辑卡片", trigger);
    const values = editor(current, map);
    const save = button(map, "保存卡片", async () => {
      await json("cards/" + card.id, values(), "PUT");
      await refresh();
      if (tab === "cards") renderList();
      await update(data.cards.find(item => item.id === card.id));
      if (map.contains(save) && !map.hidden) {
        map.hidden = true;
        if (trigger.isConnected) trigger.focus({preventScroll:true});
      }
      notify("卡片已保存");
    }, true);
  });
  if (card.ai_allowed && !card.archived) action("围绕这张卡提问", () => showChat(null, card.id));
  action("删除卡片", () => changeTrash("cards", card.id, true));
  if (card.excerpt) action("查看来源", () => {
    showCardPanel("卡片来源", trigger);
    showOrigin(card, map);
  });
  action("查看关系图谱", async () => {
    const current = await json("cards/" + card.id);
    if (!heading.isConnected) return;
    showCardPanel("卡片关系", trigger);
    renderCardGraph(current);
  });
}

function cardMenu(heading) {
  const menu = element("details", null, heading, {className:"card-menu"});
  const trigger = element("summary", "⋯", menu);
  trigger.setAttribute("aria-label", "卡片操作");
  const actions = element("div", null, menu, {className:"card-menu-actions"});
  const action = (label, run) => button(actions, label, async () => {
    menu.open = false;
    trigger.focus();
    await run();
  });
  menu.onkeydown = event => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      trigger.focus();
      event.stopPropagation();
    }
  };
  menu.onfocusout = event => {
    if (!menu.contains(event.relatedTarget)) menu.open = false;
  };

  return {action, trigger};
}

function showCardPanel(title, trigger) {
  map.replaceChildren();
  map.hidden = false;
  map.setAttribute("aria-label", title);
  const header = element("div", null, map, {className:"panel-heading"});
  element("h2", title, header);
  const dismiss = () => {
    map.hidden = true;
    trigger.focus({preventScroll:true});
  };
  const close = button(header, "关闭", dismiss);
  map.onkeydown = event => {
    if (event.key === "Escape") dismiss();
  };
  close.focus();
}

function renderCardGraph(card) {
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
  if (staticDemo) return;
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
  if (kind === "messages") {
    renderList();
    notify("候选卡已加入「待审核」");
  } else await open("drafts", result.id);
}

async function changeTrash(table, id, deleted) {
  await json(`trash/${table}/${id}`, {deleted}, "PATCH");
  await refresh();
  if (deleted) {
    const first = data[table].find(item => !item.archived);
    await open(table, first?.id ?? null);
    notify("已移到回收站");
  } else {
    renderTrash();
    notify("已恢复");
  }
}

function renderTrash() {
  extraView("回收站");
  const items = [...data.trash.cards.map(item => ({...item, table:"cards"})),
    ...data.trash.sources.map(item => ({...item, table:"sources"}))];
  if (!items.length) element("p", "回收站为空", main);
  for (const item of items) {
    const row = element("div", null, main, {className:"actions"});
    element("span", (item.table === "cards" ? "卡片 · " : "素材 · ") + item.title, row);
    button(row, "恢复", () => changeTrash(item.table, item.id, false));
  }
}

function renderSplit(item, excerpt, panel, proposals) {
  panel.replaceChildren();
  element("h2", "拆成多张卡片", panel);
  element("p", "编辑每张卡的标题和正文。保存时，第一张卡会链接其余各张，其余卡片会链接回第一张。", panel);
  const rows = element("div", null, panel);
  const cards = [];
  function add(proposal = {}) {
    if (cards.length >= 20) { notify("一次最多生成 20 张卡片"); return; }
    const group = element("fieldset", null, rows);
    const title = field(group, "标题", {value:proposal.title || "",maxLength:200});
    const body = field(group, "正文", {value:proposal.body || "",rows:4,maxLength:47000}, "textarea");
    const entry = () => ({title:title.value,body:body.value,excerpt:proposal.excerpt || excerpt});
    cards.push(entry);
    if (proposal.excerpt) {
      const source = element("details", null, group);
      element("summary", "查看原文依据", source);
      element("p", proposal.excerpt, source, {className:"quote"});
    }
    button(group, "移除此卡", () => {
      cards.splice(cards.indexOf(entry), 1);
      group.remove();
    });
  }
  proposals.forEach(add);
  button(panel, "添加一张卡片", () => add());
  button(panel, "保存并关联", async () => {
    if (cards.length < 2) { notify("请至少保留两张卡片"); return; }
    const items = cards.map(read => read());
    if (items.some(card => !card.title.trim() || !card.body.trim())) {
      notify("请填写每张卡片的标题和正文");
      return;
    }
    const saved = await json(`sources/${item.id}/split`, {cards:items});
    await refresh();
    await open("cards", saved.ids[0]);
    notify(`已创建并关联 ${saved.ids.length} 张卡片`);
  }, true);
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
    let excerpt = "";
    const capture = () => {
      const selection = window.getSelection();
      excerpt = body.contains(selection.anchorNode) && body.contains(selection.focusNode) ? selection.toString().trim() : "";
    };
    body.addEventListener("pointerup", capture);
    body.addEventListener("keyup", capture);
    const split = element("section", null, main);
    const controls = element("div", null, main, {className:"actions"});
    split.before(controls);
    const status = element("p", null, main, {className:"muted"});
    status.setAttribute("role", "status");
    controls.after(status);
    button(controls, "AI 拆成多张卡片", async () => {
      const selected = excerpt;
      status.textContent = "AI 正在按观点拆卡…";
      try {
        const result = await json(`sources/${item.id}/split/preview`, {excerpt:selected});
        if (split.isConnected) renderSplit(item, selected || item.body, split, result.cards);
      } finally {
        status.textContent = "";
      }
    });
    button(controls, "删除素材", () => changeTrash("sources", item.id, true));
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

function setChatVisible(visible) {
  chatPanel.hidden = !visible;
  chatToggle.setAttribute("aria-expanded", String(visible));
}

async function showChat(id = null, reference = null, jump = null) {
  if (chatPending) {
    setChatVisible(true);
    notify("回复完成后可以切换对话");
    return;
  }
  const token = ++chatRevision;
  const chat = id ? await json("chats/" + id) : {messages:[]};
  if (token !== chatRevision) return;
  chatInitialized = true;
  setChatVisible(true);
  renderChat(chat, jump, reference);
  if (reference) chatPanel.querySelector("textarea").focus({preventScroll:true});
}

chatToggle.onclick = () => {
  if (chatInitialized) setChatVisible(chatPanel.hidden);
  else showChat(data.chats[0]?.id).catch(error => notify(error.message));
};

function renderChat(chat, jump, reference = null, unsent = "") {
  const allowed = new Set(aiCards().map(card => card.id));
  let refs = new Set((reference ? [reference] : chat.messages.at(-1)?.refs || []).filter(id => allowed.has(id)));
  chatPanel.replaceChildren();
  const header = element("div", null, chatPanel, {className:"panel-heading"});
  element("h2", "AI 对话", header);
  button(header, "关闭", () => { setChatVisible(false); chatToggle.focus(); });
  const history = select(chatPanel, "对话记录", [["", "新对话"], ...data.chats.map(item => [item.id,item.title])], chat.id);
  history.onchange = () => showChat(Number(history.value) || null).catch(error => notify(error.message));
  const thread = element("div", null, chatPanel, {className:"chat-thread"});
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
  const context = element("details", null, chatPanel, {open:!!reference});
  const summary = element("summary", null, context);
  const updateSummary = () => { summary.textContent = "参考卡 · " + refs.size + " 张"; };
  updateSummary();
  const referenceList = element("div", null, context, {className:"references"});
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
      updateSummary();
    };
  });
  const input = field(chatPanel, "你的问题", {value:unsent, rows:3,placeholder:"从一个值得追问的问题开始",maxLength:8000}, "textarea");
  button(chatPanel, "从卡库找参考卡", async () => {
    const result = await json("search", {query:input.value.trim()});
    const picks = result.cards.slice(0, 8);
    if (!picks.length) { notify("没有找到相关卡片"); return; }
    refs = new Set(picks.map(card => card.id));
    referenceList.querySelectorAll("input").forEach((control, index) => {
      control.checked = refs.has(aiCards()[index].id);
    });
    updateSummary();
    notify(result.semantic ? "已选中相关卡片，可在发送前调整" : "已按关键词选中卡片，可在发送前调整");
  });
  button(chatPanel, "发送问题", async () => {
    if (!input.value.trim()) { input.focus(); return; }
    if (chatPending) return;
    chatPending = true;
    history.disabled = true;
    input.disabled = true;
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
            thread.scrollTop = thread.scrollHeight;
            started = true;
          }
          if (part.message_id) complete = true;
        }
      }
      if (!complete) throw new Error("回复未完整保存，请重试。");
    } catch (error) {
      notify(error.message);
    } finally {
      try {
        await refresh();
        const saved = chatId ? await json("chats/" + chatId) : chat;
        renderChat(saved, null, null, complete ? "" : question);
      } finally {
        chatPending = false;
        history.disabled = false;
        input.disabled = false;
      }
    }
  }, true);
  thread.scrollTop = thread.scrollHeight;
  if (jump) {
    const message = document.getElementById("message-"+jump);
    if (message) thread.scrollTop += message.getBoundingClientRect().top - thread.getBoundingClientRect().top;
  }
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
    const first = data[next]?.[0];
    (next === "cards" ? open("cards", null, {browse:true}) : open(next, first?.id ?? null)).catch(error => notify(error.message));
  };
});
find("#new").onclick = () => open(tab).catch(error => notify(error.message));
search.oninput = updateCardFilter;
try {
  await refresh();
  await open("home");
} catch (error) {
  notify(error.message);
}

function checkbox(parent, title, checked) {
  const label = element("label", null, parent, {className:"check"});
  const input = element("input", null, label, {type:"checkbox", checked});
  label.append(title);
  return input;
}

function renderCardSettings(card, parent) {
  const settings = element("details", null, parent, {open:true});
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
  if (staticDemo) {
    element("h1", topic.title || "主题", main);
    if (!topic.id) {
      element("p", "快照中没有已保存的主题。", main);
      return;
    }
    if (topic.question) element("p", topic.question, main);
    if (topic.body) {
      const content = element("div", null, main, {className:"markdown"});
      void previewMarkdown(content, topic.body, json).catch(error => notify(error.message));
    }
    const list = element("ol", null, main);
    for (const id of topic.card_ids) {
      const card = data.cards.find(item => item.id === id);
      if (card) button(element("li", null, list), card.title, () => open("cards", id));
    }
    return;
  }
  element("h1", topic.title || "新建主题", main);
  const title = field(main, "主题名称", {value:topic.title || "",maxLength:200});
  const question = field(main, "要回答的问题", {value:topic.question || "",maxLength:8000});
  if (topic.reading_path?.length) {
    const panel = element("details", null, main);
    element("summary", "按保存的层级阅读", panel);
    const content = element("div", null, panel);
    panel.ontoggle = async () => {
      if (!panel.open || content.childNodes.length) return;
      const path = createReadingPath(content, json, () => data.cards, notify, id => open("cards", id), null, renderChildMenu);
      const nodes = [];
      for (const entry of topic.reading_path) {
        const card = data.cards.find(item => item.id === entry.card_id);
        nodes.push(card ? await path.append(card, nodes[entry.parent]) : null);
      }
    };
  }
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
  browsingCards = false;
  main.hidden = false;
  find(".catalog").append(searchBox);
  renderList();
  ++revision;
  setChatVisible(false);
  main.replaceChildren();
  map.hidden = true;
  map.replaceChildren();
  element("h1", title, main);
}

async function renderGlobalGraph(parent, preview) {
  element("h1", "全局图谱", parent);
  const filters = element("div", null, parent, {className:"graph-filters"});
  const tag = select(filters, "标签", [["","全部标签"], ...choiceList(availableTags())]);
  const kind = select(filters, "关系类型", [["","全部关系"], ...choiceList([...relationTypes, "正文引用"])]);
  const display = element("div", null, parent);
  let requestId = 0;
  async function update() {
    const token = ++requestId;
    const graph = await json("graph?" + new URLSearchParams({tag:tag.value,kind:kind.value}));
    if (!display.isConnected || token !== requestId) return;
    display.replaceChildren();
    preview.hidden = true;
    element("p", `${graph.cards.length} 张卡片，${graph.groups.length} 个关联群组`, display, {className:"muted"});
    if (!graph.cards.length) {
      element("p", "当前筛选下没有卡片", display);
      return;
    }
    drawConstellation(display, graph, svgNode, node => {
      preview.replaceChildren();
      preview.hidden = false;
      const card = data.cards.find(item => item.id === node.id);
      element("h2", node.title, preview);
      if (card) element("p", cardSnippet(card.body, ""), preview, {className:"muted"});
      button(preview, "打开卡片", () => open("cards", node.id), true);
    });
  }
  tag.onchange = kind.onchange = () => update().catch(error => notify(error.message));
  await update().catch(error => {
    if (display.isConnected) element("p", error.message, display, {role:"status"});
  });
}

function dataTools() {
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

find("#data-tools").onclick = dataTools;

find("header nav").onclick = event => {
  const menu = event.target.closest("button, a")?.closest(".top-menu");
  if (menu) menu.open = false;
};

for (const view of ["sources", "drafts"]) {
  find("#inbox-" + view).onclick = () => open(view, data[view][0]?.id ?? null).catch(error => notify(error.message));
}

find("#trash").onclick = renderTrash;
