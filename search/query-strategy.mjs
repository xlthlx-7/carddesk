// Bounded lexical expansion; QMD syntax is preserved for advanced queries.
export function keywordPlan(keywords){
 const input=keywords.trim();
 const words=[...new Set(input.split(/\s+/))];
 const simple=words.every(w=>/^[\p{L}\p{N}_-]+$/u.test(w)&&!w.startsWith('-'));
 if(!simple)return {version:2,kind:'qmd-syntax',queries:[input],terms:[]};
 if(words.length>8)throw new RangeError('最多提供 8 个短关键词；复杂表达请使用 QMD 查询语法');
 return {version:2,kind:'bounded-union',queries:[...new Set([input,...words])],terms:words};
}
export function visibleText(body){
 return body.replace(/^---\n[\s\S]*?\n---\n/,'').replace(/^>.*$/gm,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
}
export function coverage(body,terms){
 const text=visibleText(body).toLocaleLowerCase(),title=(text.match(/^#\s+(.+)$/m)?.[1]??'');
 const matched=terms.filter(t=>text.includes(t.toLocaleLowerCase()));
 const titleMatched=terms.filter(t=>title.includes(t.toLocaleLowerCase()));
 return {matched,titleMatched,body:terms.length?matched.length/terms.length:0,title:terms.length?titleMatched.length/terms.length:0};
}
// Rank positions are comparable across branches; raw BM25/vector scores aren't.
export function fuse(runs){
 const merged=new Map();
 for(const {name,weight=1,hits} of runs){
  const seen=new Set();
  hits.forEach((hit,i)=>{const uri=hit.file??hit.filepath;if(seen.has(uri))return;seen.add(uri);
   let item=merged.get(uri);if(!item){item={...hit,fusionScore:0,branches:[]};merged.set(uri,item);}
   item.fusionScore+=weight/(60+i+1);item.branches.push({name,rank:i+1});
  });
 }
 return [...merged.values()].sort((a,b)=>b.fusionScore-a.fusionScore||String(a.file??a.filepath).localeCompare(String(b.file??b.filepath)));
}
