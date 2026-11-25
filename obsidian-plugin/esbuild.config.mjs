import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('dist/carddesk', {recursive:true});
await build({entryPoints:['src/main.ts'], bundle:true, loader:{'.md':'text'}, external:['obsidian'], format:'cjs', platform:'browser', target:'es2020', outfile:'dist/carddesk/main.js'});
for (const name of ['manifest.json','styles.css']) await copyFile(name, `dist/carddesk/${name}`);
