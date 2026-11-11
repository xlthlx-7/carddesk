const mermaidModule = "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";

function showDiagram(code) {
  const source = code.parentElement;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "查看 Mermaid 源码";
  const frame = document.createElement("iframe");
  frame.className = "diagram";
  frame.title = "Mermaid 流程图";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.referrerPolicy = "no-referrer";
  const escaped = code.textContent.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  frame.srcdoc = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'">
    <style>body{margin:.65rem;font:14px system-ui;color:#172c46}svg{max-width:100%;height:auto}</style>
    <p id="result" role="status">正在加载流程图…</p><pre id="source" hidden>${escaped}</pre>
    <script type="module">
      const result = document.getElementById("result");
      try {
        const {default: mermaid} = await import("${mermaidModule}");
        mermaid.initialize({startOnLoad:false, securityLevel:"strict", htmlLabels:false});
        const {svg} = await mermaid.render("card-diagram", document.getElementById("source").textContent);
        result.innerHTML = svg;
      } catch {
        result.textContent = "流程图无法显示。请检查网络或展开下方源码核对语法。";
      }
    </script></html>`;
  source.before(frame, details);
  details.append(summary, source);
}

export async function previewMarkdown(container, body, request) {
  const {html} = await request("markdown", {body});
  // The server escapes raw HTML and rejects unsafe URL schemes.
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("a").forEach(link => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  template.content.querySelectorAll("img").forEach(image => {
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
  });
  template.content.querySelectorAll("pre > code.language-mermaid").forEach(showDiagram);
  container.replaceChildren(template.content);
}
