let snapshot;

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
  if (route === "library") return {cards, topics, demo:true, drafts:[], sources:[]};
  if (route === "markdown" && Object.hasOwn(markdown, body.body)) return {html:markdown[body.body]};
  if (route === "graph") {
    const filters = new URLSearchParams(query);
    const tag = filters.get("tag"), kind = filters.get("kind");
    const nodes = cards.filter(card => !card.archived && (!tag || card.tags.includes(tag)));
    const ids = new Set(nodes.map(card => card.id));
    const visible = edges.filter(edge => ids.has(edge.origin) && ids.has(edge.target) && (!kind || kind === edge.kind));
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
        const related = edges.filter(edge => edge.origin === id || edge.target === id).map(edge => {
          const neighbor = edge.origin === id ? edge.target : edge.origin;
          return {...edge, neighbor, title:titles.get(neighbor)};
        });
        return {...card, edges:related, merged_sources:[]};
      }
    }
  }
  throw new Error("公开演示仅支持浏览。");
}
