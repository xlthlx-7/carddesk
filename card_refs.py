import re
import unicodedata
from collections import defaultdict

from markdown_it import MarkdownIt
from markdown_it.common.utils import escapeHtml

REFERENCE = re.compile(r"\[\[([^\[\]\n]+)\]\](\*\*)?")


def reference_rule(state, silent):
    if state.linkLevel or state.src[state.pos:state.pos + 2] != "[[":
        return False
    match = REFERENCE.match(state.src, state.pos, state.posMax)
    if not match:
        return False
    label = match[1].strip()
    # Accept the misplaced closing bold marker in pasted wiki links.
    bold = label.startswith("**") and (label.endswith("**") or match[2])
    if bold:
        label = label[2:-2] if label.endswith("**") else label[2:]
    target, separator, alias = label.partition("|")
    target = target.strip()
    if not target:
        return False
    end = match.end() if bold and match[2] else match.end(1) + 2
    if not silent:
        token = state.push("card_reference", "button", 0)
        token.meta = {"target": target, "bold": bool(bold)}
        token.content = alias.strip() if separator and alias.strip() else target
    state.pos = end
    return True


def render_reference(tokens, index, options, env):
    token = tokens[index]
    target = escapeHtml(token.meta["target"])
    label = escapeHtml(token.content)
    if token.meta["bold"]:
        label = f"<strong>{label}</strong>"
    return f'<button type="button" class="card-reference" data-reference="{target}">{label}</button>'


markdown = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])
markdown.inline.ruler.before("link", "card_reference", reference_rule)
markdown.renderer.rules["card_reference"] = render_reference


def title_key(value):
    return unicodedata.normalize("NFKC", value).strip().casefold()


def reference_edges(cards):
    by_id = {card["id"]: card for card in cards}
    titles = defaultdict(list)
    for card in cards:
        titles[title_key(card["title"])].append(card["id"])
    for card in cards:
        for block in markdown.parse(card["body"]):
            for token in block.children or ():
                if token.type != "card_reference":
                    continue
                target = token.meta["target"]
                if re.fullmatch(r"#[0-9]{1,19}", target):
                    matches = [int(target[1:])]
                else:
                    matches = titles[title_key(target)]
                if len(matches) != 1:
                    continue
                other = by_id.get(matches[0])
                while other and other["merged_into"] is not None:
                    other = by_id.get(other["merged_into"])
                if other and other["id"] != card["id"]:
                    yield {"origin": card["id"], "target": other["id"],
                           "kind": "正文引用", "reason": token.content}
