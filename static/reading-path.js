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

export function createReadingPath(container, request, cards, notify, openCard, onChange, childMenu) {
  const roots = [];

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
    let title;
    let headingRow;
    if (parent || !article.isConnected) {
      headingRow = document.createElement("div");
      headingRow.className = "card-heading";
      const heading = document.createElement("h2");
      const open = document.createElement("button");
      open.type = "button";
      title = open;
      title.textContent = card.title;
      open.className = "reading-card-title";
      open.title = "打开卡片";
      open.onclick = () => openCard(card.id).catch(error => notify(error.message));
      heading.append(open);
      headingRow.append(heading);
      column.append(headingRow);
    }
    const childrenPanel = document.createElement("div");
    childrenPanel.className = "reading-children";
    column.append(article, childrenPanel);
    (parent?.childrenPanel || container).append(column);
    const node = {card, parent, article, column, childrenPanel, children:[]};
    host.push(node);
    if (parent && childMenu) childMenu(card, headingRow, async updated => {
      node.card = updated;
      title.textContent = updated.title;
      await render();
    });
    await render();
    return node;

    async function render() {
      try {
        await previewMarkdown(article, node.card.body, request, async (reference, control) => {
          const target = referenceTarget(reference, cards());
          if (!target) { notify("找不到唯一的引用卡片，请核对标题或重新选择卡片"); return; }
          for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
            if (ancestor.card.id === target.id) { focus(ancestor); return; }
          }
          const opened = node.children.find(child => child.card.id === target.id);
          if (opened) {
            node.children.splice(node.children.indexOf(opened), 1);
            opened.column.remove();
            syncControls(node);
            onChange?.();
            return;
          }
          if (entries().length >= 100) { notify("阅读路径最多展开 100 张卡片"); return; }
          control.disabled = true;
          try {
            if (!container.isConnected) return;
            const expanded = await append(target, node);
            if (expanded.column.isConnected) {
              syncControls(node);
              onChange?.();
              focus(expanded);
            }
          } finally {
            control.disabled = false;
          }
        });
        syncControls(node);
      } catch (error) {
        article.textContent = node.card.body;
        notify(error.message);
      }
    }
  }

  function syncControls(node) {
    for (const control of node.article.querySelectorAll("button.card-reference")) {
      const target = referenceTarget(control.dataset.reference, cards());
      control.setAttribute("aria-expanded", String(node.children.some(child => child.card.id === target?.id)));
    }
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

  async function restore(root, article, saved) {
    const nodes = [await append(root, null, article)];
    const library = cards();
    for (const entry of saved.slice(1, 100)) {
      if (!container.isConnected) return;
      const parent = nodes[entry?.parent];
      const card = library.find(item => item.id === entry?.card_id);
      const node = parent && card ? await append(card, parent) : null;
      nodes.push(node);
    }
    nodes.filter(Boolean).forEach(syncControls);
  }

  return {append, entries, restore};
}
