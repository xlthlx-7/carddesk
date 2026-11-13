"""Build the public, read-only Carddesk snapshot in dist/demo."""
import json
from pathlib import Path
from shutil import copytree
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import database, markdown
from card_refs import reference_edges
from library_v2 import all_cards, topic_view


def main():
    with database() as db:
        db.execute("BEGIN")
        library = all_cards(db)
        cards = [
            {key: card[key] for key in ("id", "title", "body", "kind", "tags", "archived")}
            for card in library
        ]
        ids = {card["id"] for card in cards}
        topics = [topic_view(row) for row in db.execute("SELECT * FROM topics ORDER BY id DESC")]
        links = [dict(row) for row in db.execute("SELECT * FROM links ORDER BY id")]
        edges = [edge for edge in [*links, *reference_edges(library)]
                 if edge["origin"] in ids and edge["target"] in ids]

    output = ROOT / "dist/demo"
    output.mkdir(parents=True, exist_ok=True)
    copytree(ROOT / "static", output / "static", dirs_exist_ok=True)
    index = (ROOT / "static/index.html").read_text(encoding="utf-8")
    index = index.replace("<html ", '<html data-static-demo="true" ', 1)
    index = index.replace('="/static/', '="./static/').replace('href="/api/export"', 'href="./cards.md" download')
    (output / "index.html").write_text(index, encoding="utf-8")
    (output / ".nojekyll").touch()

    bodies = {card["body"] for card in cards} | {topic["body"] for topic in topics}
    snapshot = {"cards": cards, "topics": topics, "edges": edges,
                "markdown": {body: markdown.render(body) for body in sorted(bodies)}}
    (output / "snapshot.json").write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    export = ["# 知识卡片"]
    for card in reversed(cards):
        export.extend([f"## {card['title']} [#{card['id']}]", card["body"]])
    (output / "cards.md").write_text("\n\n".join(export) + "\n", encoding="utf-8")
    print(f"{len(cards)} cards, {len(edges)} edges, {len(topics)} topics → {output}")


if __name__ == "__main__":
    main()
