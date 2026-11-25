let snapshot;
const chats = [], drafts = [];
let messageId = 0, draftId = 0;
const sample = {
  id:1, title:"示例素材 · 如何组织知识卡片", url:"",
  body:"每张知识卡记录一个可以独立理解的观点，方便在其他主题中引用。\n\n总结卡按阅读顺序链接各个观点，让零散的卡片能组成一条完整的阅读路径。\n\n跨主题链接应说明两张卡的关系，例如补充、举例或限制。"
};

function searchCards(cards, query) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) || [])];
  return cards.filter(card => !card.archived).map(card => {
    const title = card.title.toLowerCase(), body = card.body.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 3 : body.includes(term) ? 1 : 0), 0);
    return {card, score};
  }).filter(item => item.score).sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.card);
}

export async function demoChat({chat_id, question, refs}) {
  const {cards} = await demoRequest("library");
  const references = refs.length ? cards.filter(card => refs.includes(card.id)) : searchCards(cards, question);
  let chat = chats.find(item => item.id === chat_id);
  if (!chat) {
    chat = {id:chats.length + 1, title:question.slice(0, 36), messages:[]};
    chats.unshift(chat);
  }
  const answer = references.length
    ? references.slice(0, 3).map(card => {
        const summary = card.body.split("\n\n")[0].replace(/\[\[([^\]]+)\]\]/g, (_, text) => text.split("|").at(-1));
        return `「${card.title}」\n${summary.slice(0, 220)}`;
      }).join("\n\n")
    : "可以先把问题拆成三个部分：核心概念、实际例子和适用边界。选择一张参考卡后，演示会展示卡库中的相关内容。";
  const ids = references.slice(0, 3).map(card => card.id);
  const message = {id:++messageId, chat_id:chat.id, role:"assistant", body:answer, refs:ids, cards:[], title:question};
  chat.messages.push({id:++messageId, role:"user", body:question, refs:ids, cards:[]}, message);
  return new Response([{chat_id:chat.id}, {delta:answer}, {message_id:message.id}].map(part => JSON.stringify(part) + "\n").join(""));
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);

function renderDemoText(body) {
  return body.split(/\n\s*\n/).map(paragraph => "<p>" + escapeHtml(paragraph)
    .replace(/\[\[(#[0-9]+)\|([^\]]+)\]\]/g, '<button type="button" class="card-reference" data-reference="$1">$2</button>')
    .replaceAll("\n", "<br>") + "</p>").join("");
}

function addCard(cards, payload, origin = {}) {
  const id = cards.reduce((max, card) => Math.max(max, card.id), 0) + 1;
  const title = payload.title.trim(), body = payload.body.trim();
  if (!title || !body) throw new Error("请填写卡片标题和正文。");
  cards.unshift({...origin, id, title, body, kind:payload.kind || "观点", tags:["演示生成"], ai_allowed:true});
  return id;
}

function groupsFor(cards, edges) {
  const remaining = new Map(cards.map(card => [card.id, card]));
  const neighbors = new Map(cards.map(card => [card.id, []]));
  for (const {origin, target} of edges) {
    neighbors.get(origin).push(target);
    neighbors.get(target).push(origin);
  }
  const groups = [];
  for (const {id} of cards) {
    if (!remaining.has(id)) continue;
    const stack = [id], ids = [], tags = new Map();
    while (stack.length) {
      const next = stack.pop();
      const card = remaining.get(next);
      if (!card) continue;
      remaining.delete(next);
      ids.push(next);
      for (const tag of card.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
      stack.push(...neighbors.get(next));
    }
    const label = [...tags].sort((a, b) => b[1] - a[1])[0]?.[0] || cards.find(card => card.id === id).title;
    groups.push({ids, label});
  }
  return groups.sort((a, b) => b.ids.length - a.ids.length);
}

export async function demoRequest(path, body) {
  snapshot ??= fetch(new URL("../snapshot.json", import.meta.url)).then(response => {
    if (!response.ok) throw new Error("无法加载演示数据。");
    return response.json();
  }).catch(error => {
    snapshot = undefined;
    throw error;
  });
  const {cards, topics, edges, markdown} = await snapshot;
  const [route, query] = path.split("?");
  if (route === "library") return {cards:cards.map(card => ({...card, ai_allowed:!card.archived})), topics, demo:true, drafts, sources:[sample], chats};
  if (route === "markdown") return {html:Object.hasOwn(markdown, body.body) ? markdown[body.body] : renderDemoText(body.body)};
  if (route === "search") return {cards:searchCards(cards, body.query), semantic:false};
  if (route === "similar") return searchCards(cards, body.query);
  const messages = chats.flatMap(chat => chat.messages);
  if (route.startsWith("chats/")) return chats.find(chat => chat.id === Number(route.split("/")[1]));
  if (route.startsWith("messages/")) return messages.find(message => message.id === Number(route.split("/")[1]));
  if (route === "drafts" && body) {
    const origin = body.kind === "sources" ? sample : messages.find(message => message.id === body.id && message.role === "assistant");
    if (!origin) throw new Error("找不到候选卡来源。");
    const excerpt = body.excerpt || origin.body;
    const related = (origin.refs || []).map(id => cards.find(card => card.id === id)).filter(Boolean);
    const draft = {id:++draftId, title:origin.title.slice(0, 200), kind:"观点", excerpt,
      source_id:body.kind === "sources" ? sample.id : null, message_id:origin.role ? origin.id : null,
      body:[excerpt, ...related.map(card => `相关卡片 · [[#${card.id}|${card.title}]]`)].join("\n\n")};
    drafts.unshift(draft);
    return {id:draft.id};
  }
  const draftRoute = /^drafts\/(\d+)\/(accept|discard)$/.exec(route);
  if (draftRoute) {
    const index = drafts.findIndex(draft => draft.id === Number(draftRoute[1]));
    if (index < 0) throw new Error("候选卡已处理。");
    const draft = drafts[index];
    const id = draftRoute[2] === "accept" ? addCard(cards, body, draft) : null;
    if (id && draft.message_id) messages.find(message => message.id === draft.message_id)?.cards.push(cards[0]);
    drafts.splice(index, 1);
    return {id};
  }
  if (route === "sources/1/split/preview") {
    const titles = ["一张卡记录一个观点", "总结卡组织阅读路径", "跨主题链接说明关系"];
    const selected = body.excerpt.trim();
    const sections = selected.split(/(?<=[。！？])\s*|\n+/).filter(Boolean);
    if (selected && sections.length < 2) throw new Error("请选择包含两个观点的片段，或取消选区后拆分整篇素材。");
    return {cards:(selected ? sections : sample.body.split("\n\n")).map((excerpt, i) => ({
      title:selected ? excerpt.slice(0, 24) : titles[i], body:excerpt, excerpt
    }))};
  }
  if (route === "sources/1/split") {
    if (body.cards.length < 2 || body.cards.some(card => !card.title.trim() || !card.body.trim())) {
      throw new Error("请至少填写两张完整卡片。");
    }
    const ids = body.cards.map(card => addCard(cards, card, {source_id:sample.id, excerpt:card.excerpt}));
    const created = ids.map(id => cards.find(card => card.id === id));
    for (const [index, card] of created.entries()) {
      const linked = index === 0 ? created.slice(1) : [created[0]];
      card.body += "\n\n" + linked.map(target => `[[#${target.id}|${target.title}]]`).join("\n");
    }
    return {ids};
  }
  const currentEdges = [...edges];
  const original = new Set(edges.map(edge => `${edge.origin}:${edge.target}`));
  const cardIds = new Set(cards.map(card => card.id));
  for (const card of cards.filter(item => item.tags.includes("演示生成"))) {
    for (const match of card.body.matchAll(/\[\[#([0-9]+)\|[^\]]+\]\]/g)) {
      const target = Number(match[1]), pair = `${card.id}:${target}`;
      if (target !== card.id && cardIds.has(target) && !original.has(pair)) {
        currentEdges.push({origin:card.id, target, kind:"正文引用", reason:"卡片正文链接"});
        original.add(pair);
      }
    }
  }
  if (route === "graph") {
    const filters = new URLSearchParams(query);
    const tag = filters.get("tag"), kind = filters.get("kind");
    const nodes = cards.filter(card => !card.archived && (!tag || card.tags.includes(tag)));
    const ids = new Set(nodes.map(card => card.id));
    const visible = currentEdges.filter(edge => ids.has(edge.origin) && ids.has(edge.target) && (!kind || kind === edge.kind));
    return {cards:nodes, edges:visible, groups:groupsFor(nodes, visible)};
  }
  const match = /^(cards|topics)\/(\d+)$/.exec(route);
  if (match && body === undefined) {
    const id = Number(match[2]);
    if (match[1] === "topics") {
      const topic = topics.find(item => item.id === id);
      if (topic) return topic;
    } else {
      const card = cards.find(item => item.id === id);
      if (card) {
        const titles = new Map(cards.map(item => [item.id, item.title]));
        const related = currentEdges.filter(edge => edge.origin === id || edge.target === id).map(edge => {
          const neighbor = edge.origin === id ? edge.target : edge.origin;
          return {...edge, neighbor, title:titles.get(neighbor)};
        });
        return {...card, edges:related, merged_sources:[]};
      }
    }
  }
  throw new Error("公开演示暂不支持此操作。");
}
