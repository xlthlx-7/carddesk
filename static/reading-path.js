import {previewMarkdown} from "./preview.js";

const titleKey = value => value.normalize("NFKC").trim().toLowerCase();

export function referenceTarget(reference, cards) {
  const matches = /^#[0-9]{1,19}$/.test(reference)
    ? cards.filter(card => card.id === Number(reference.slice(1)))
    : cards.filter(card => titleKey(card.title) === titleKey(reference));
  if (matches.length !== 1) return null;
  let card = matches[0];
  const seen = new Set();
  while (card?.merged_into && !seen.has(card.id)) {
    seen.add(card.id);
    card = cards.find(item => item.id === card.merged_into);
  }
  return card?.merged_into ? null : card;
}

export function attachReferencePicker(body, panel, cards) {
  function update() {
    panel.replaceChildren();
    const end = body.selectionStart;
    const match = /\[\[([^\[\]\n]*)$/.exec(body.value.slice(0, end));
    if (!match || end !== body.selectionEnd || match[1].includes("|")) return;
    const query = titleKey(match[1]);
    const candidates = cards().filter(card => !card.archived && titleKey(card.title).includes(query)).slice(0, 8);
    for (const card of candidates) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.textContent = card.title;
      choice.onclick = () => {
        const label = card.title.replace(/[\[\]|\r\n]/g, " ").trim() || "卡片";
        const closing = body.value.slice(end, end + 2) === "]]" ? 2 : 0;
        const reference = `[[#${card.id}|${label}]]`;
        if (body.value.length + reference.length - (end + closing - match.index) > body.maxLength) return;
        body.setRangeText(reference, match.index, end + closing, "end");
        panel.replaceChildren();
        body.focus();
      };
      panel.append(choice);
    }
  }
  body.addEventListener("input", update);
  body.addEventListener("click", update);
  body.addEventListener("keyup", event => {
    if (event.key === "Escape") panel.replaceChildren();
    else if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) update();
  });
}

export function createReadingPath(container, request, cards, notify, openCard) {
  const roots = [];
  let count = 0;

  function focus(node) {
    node.article.focus({preventScroll:true});
    node.article.scrollIntoView({
      block:"center",
      behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
    });
  }

  async function append(card, parent, article) {
    const host = parent ? parent.children : roots;
    const column = document.createElement("section");
    column.className = "reading-branch";
    article ||= document.createElement("article");
    article.classList.add("markdown", "reading-card");
    article.tabIndex = -1;
    if (parent || !article.isConnected) {
      const heading = document.createElement("h2");
      heading.textContent = card.title;
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "打开卡片";
      open.onclick = () => openCard(card.id).catch(error => notify(error.message));
      column.append(heading, open);
    }
    const childrenPanel = document.createElement("div");
    childrenPanel.className = "reading-children";
    column.append(article, childrenPanel);
    (parent?.childrenPanel || container).append(column);
    const node = {card, parent, article, childrenPanel, children:[]};
    host.push(node);
    count += 1;
    try {
      await previewMarkdown(article, card.body, request, async (reference, control) => {
        const target = referenceTarget(reference, cards());
        if (!target) { notify("找不到唯一的引用卡片，请核对标题或重新选择卡片"); return; }
        for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
          if (ancestor.card.id === target.id) { focus(ancestor); return; }
        }
        const opened = node.children.find(child => child.card.id === target.id);
        if (opened) { focus(opened); return; }
        if (count >= 100) { notify("阅读路径最多展开 100 张卡片"); return; }
        control.disabled = true;
        try {
          if (container.isConnected) focus(await append(target, node));
        } finally {
          control.disabled = false;
        }
      });
    } catch (error) {
      article.textContent = card.body;
      notify(error.message);
    }
    return node;
  }

  function entries() {
    const result = [];
    function walk(node, parent = null) {
      const index = result.length;
      result.push({card_id:node.card.id, parent});
      for (const child of node.children) walk(child, index);
    }
    for (const root of roots) walk(root);
    return result;
  }

  return {append, entries};
}
