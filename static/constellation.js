const palette = ["#75bdff", "#74dfdb", "#ae9aff", "#f3a1c8", "#e9c889"];
const width = 820;
const height = 560;

export function drawConstellation(parent, graph, svgNode, onSelect) {
  const canvas = svgNode("svg", {viewBox:`0 0 ${width} ${height}`, class:"constellation",
    role:"group", "aria-label":"全局知识图谱"}, parent);
  const edgesLayer = svgNode("g", {"aria-hidden":"true"}, canvas);
  const nodesLayer = svgNode("g", {}, canvas);
  const nodes = new Map(graph.cards.map(card => [card.id, {...card, neighbors:new Set(), vx:0, vy:0}]));
  const edges = new Map();
  for (const edge of graph.edges) {
    const a = nodes.get(edge.origin), b = nodes.get(edge.target);
    if (!a || !b || a === b) continue;
    a.neighbors.add(b);
    b.neighbors.add(a);
    const key = [a.id,b.id].sort((x,y) => x-y).join(":");
    if (!edges.has(key)) edges.set(key, {a,b, line:svgNode("line", {}, edgesLayer)});
  }
  const list = [...nodes.values()];
  const role = node => node.tags.includes("索引") ? 2 : node.tags.includes("总结") ? 1 : 0;
  const order = (a,b) => role(b)-role(a) || b.neighbors.size-a.neighbors.size || a.id-b.id;
  const hub = [...list].sort(order)[0];
  if (!hub) return;
  const branches = [...hub.neighbors].filter(node => role(node)).sort(order);
  const groups = graph.groups.filter(group => !group.ids.includes(hub.id) && group.ids.length > 1);
  const anchors = [...branches, ...groups.map(group => group.ids.map(id => nodes.get(id)).filter(Boolean).sort(order)[0])].filter(Boolean);
  const queue = [];
  anchors.forEach((node,index) => {
    const angle = index * 2 * Math.PI / anchors.length - Math.PI / 2;
    node.anchor = {x:width/2+Math.cos(angle)*234,y:height/2+Math.sin(angle)*150,color:palette[(index+1)%palette.length]};
    queue.push(node);
  });
  hub.anchor = {x:width/2,y:height/2,color:palette[0]};
  for (let index=0; index<queue.length; index++) {
    for (const neighbor of queue[index].neighbors) {
      if (!neighbor.anchor) {
        neighbor.anchor = queue[index].anchor;
        queue.push(neighbor);
      }
    }
  }
  list.forEach((node,index) => {
    const angle = index * 2.399963;
    const anchor = node.anchor || {x:width/2+Math.cos(angle)*285,y:height/2+Math.sin(angle)*190,color:palette[0]};
    node.anchor = anchor;
    node.x = anchor.x + Math.cos(angle)*34;
    node.y = anchor.y + Math.sin(angle)*34;
    const radius = (node === hub ? 21 : role(node) === 2 ? 12 : role(node) === 1 ? 9 : 4)
      + Math.min(4, Math.sqrt(node.neighbors.size));
    const group = svgNode("g", {role:"button",tabindex:0,"aria-label":node.title,"aria-pressed":"false",
      class:`constellation-node${node === hub || role(node) ? " is-core" : ""}`}, nodesLayer);
    group.style.setProperty("--node-color", anchor.color);
    svgNode("circle", {r:Math.max(13,radius+6),fill:"transparent"}, group);
    if (node === hub || role(node)) svgNode("circle", {r:radius+5,class:"constellation-ring"}, group);
    svgNode("circle", {r:radius,class:"constellation-dot"}, group);
    const label = svgNode("text", {x:radius+9,y:4}, group);
    label.textContent = node.title.length > 14 ? node.title.slice(0,14)+"…" : node.title;
    svgNode("title", {}, group).textContent = node.title;
    node.group = group;
  });

  let selected, hovered, drag, frame = 0, remaining = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function highlight() {
    const focus = hovered || selected;
    for (const node of list) {
      node.group.classList.toggle("is-muted", !!focus && focus !== node && !focus.neighbors.has(node));
      node.group.classList.toggle("is-focus", focus === node);
      node.group.setAttribute("aria-pressed", String(selected === node));
    }
    for (const {a,b,line} of edges.values()) {
      line.classList.toggle("is-highlighted", !!focus && (a === focus || b === focus));
      line.classList.toggle("is-muted", !!focus && a !== focus && b !== focus);
    }
  }
  function paint() {
    for (const node of list) {
      node.group.setAttribute("transform", `translate(${node.x},${node.y})`);
      const label = node.group.querySelector("text");
      const flip = node.x > width - 170;
      label.setAttribute("text-anchor", flip ? "end" : "start");
      const offset = Number(label.getAttribute("x"));
      label.setAttribute("x", flip ? -Math.abs(offset) : Math.abs(offset));
    }
    for (const {a,b,line} of edges.values()) {
      line.setAttribute("x1",a.x); line.setAttribute("y1",a.y);
      line.setAttribute("x2",b.x); line.setAttribute("y2",b.y);
    }
  }
  function step() {
    for (const {a,b} of edges.values()) {
      const dx=b.x-a.x, dy=b.y-a.y, distance=Math.hypot(dx,dy) || 1;
      const force=(distance-94)*.022/distance;
      a.vx+=dx*force; a.vy+=dy*force;
      b.vx-=dx*force; b.vy-=dy*force;
    }
    for (let i=0; i<list.length; i++) {
      const a=list[i];
      for (let j=i+1; j<Math.min(list.length,i+100); j++) {
        const b=list[j], dx=b.x-a.x, dy=b.y-a.y;
        const squared=Math.max(16,dx*dx+dy*dy);
        if (squared>18000) continue;
        const force=Math.min(.32,170/squared);
        a.vx-=dx*force; a.vy-=dy*force;
        b.vx+=dx*force; b.vy+=dy*force;
      }
    }
    for (const node of list) {
      const strength=node === hub ? .14 : .042;
      node.vx=(node.vx+(node.anchor.x-node.x)*strength)*.68;
      node.vy=(node.vy+(node.anchor.y-node.y)*strength)*.68;
      if (drag?.node === node) continue;
      node.x=Math.max(32,Math.min(width-32,node.x+node.vx));
      node.y=Math.max(34,Math.min(height-34,node.y+node.vy));
    }
  }
  function animate() {
    frame = 0;
    if (!canvas.isConnected) return;
    step();
    paint();
    if (--remaining > 0) frame=requestAnimationFrame(animate);
  }
  function settle(steps) {
    if (reducedMotion) {
      for (let i=0;i<steps;i++) step();
      paint();
    } else {
      remaining=steps;
      if (!frame) frame=requestAnimationFrame(animate);
    }
  }
  function select(node) {
    selected=node;
    highlight();
    onSelect(node);
  }

  for (const node of list) {
    const group=node.group;
    group.onpointerenter=() => { hovered=node; highlight(); };
    group.onpointerleave=() => { hovered=null; highlight(); };
    group.onfocus=() => { hovered=node; highlight(); };
    group.onblur=() => { hovered=null; highlight(); };
    group.onkeydown=event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(node);
      }
    };
    group.onpointerdown=event => {
      if (event.button !== 0 || drag) return;
      drag={node,id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
      group.setPointerCapture(event.pointerId);
    };
    group.onpointermove=event => {
      if (drag?.id !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5) return;
      drag.moved=true;
      const matrix=canvas.getScreenCTM();
      if (!matrix) return;
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      node.x=Math.max(32,Math.min(width-32,point.x));
      node.y=Math.max(34,Math.min(height-34,point.y));
      if (reducedMotion) paint();
      else settle(20);
    };
    group.onpointerup=event => {
      if (drag?.id !== event.pointerId) return;
      const moved=drag.moved;
      drag=null;
      if (moved) settle(45);
      else select(node);
    };
    group.onlostpointercapture=() => {
      if (drag?.node === node) { drag=null; settle(30); }
    };
  }
  for (let i=0;i<65;i++) step();
  paint();
}
