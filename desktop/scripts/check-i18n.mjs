import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { IntlMessageFormat } from 'intl-messageformat';
const root=fileURLToPath(new URL('../src/',import.meta.url)), issues=[];
const zhFiles=(await readdir(path.join(root,'locales/zh-CN'))).filter(file=>file.endsWith('.json')).sort();
const enFiles=(await readdir(path.join(root,'locales/en-US'))).filter(file=>file.endsWith('.json')).sort();
if(JSON.stringify(zhFiles)!==JSON.stringify(enFiles))issues.push('Locale domain files differ');
let count=0;
function parameters(message){const found=new Set();function visit(nodes){for(const node of nodes){if(node.type!==0&&node.type!==7&&'value'in node)found.add(node.value);if('options'in node)for(const option of Object.values(node.options))visit(option.value);}}visit(message.getAst());return [...found].sort();}
for(const file of zhFiles){
 const zh=JSON.parse(await readFile(path.join(root,'locales/zh-CN',file),'utf8'));
 const en=JSON.parse(await readFile(path.join(root,'locales/en-US',file),'utf8'));
 if(JSON.stringify(Object.keys(zh).sort())!==JSON.stringify(Object.keys(en).sort()))issues.push(`${file}: locale keys differ`);
 for(const[key,source]of Object.entries(zh)){
  count++;const translated=en[key];
  if(typeof translated!=='string'||!translated.trim()){issues.push(`${file}:${key}: missing English value`);continue;}
  if(/\p{Script=Han}/u.test(translated)&&!(file==='common.json'&&key==='chinese'))issues.push(`${file}:${key}: untranslated Chinese copy`);
  try{const message=new IntlMessageFormat(translated,'en-US',undefined,{ignoreTag:true});const expected=[...new Set([...source.matchAll(/\{(\w+)\}/g)].map(match=>match[1]))].sort();if(JSON.stringify(parameters(message))!==JSON.stringify(expected))issues.push(`${file}:${key}: placeholders differ`);message.format(Object.fromEntries(expected.map(name=>[name,2])));}catch(error){issues.push(`${file}:${key}: invalid ICU message: ${error.message}`);}
 }
}
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()&&entry.name!=='locales')await walk(file);else if(entry.isFile()&&/\.tsx?$/.test(file)){const source=await readFile(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);function visit(node){let text;if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isJsxText(node))text=node.text;if(ts.isTemplateExpression(node))text=node.head.text+node.templateSpans.map(span=>span.literal.text).join('');if(text&&/\p{Script=Han}/u.test(text)){const pos=tree.getLineAndCharacterOfPosition(node.getStart(tree));issues.push(`${path.relative(root,file)}:${pos.line+1}: hardcoded interface copy`);}ts.forEachChild(node,visit);}visit(tree);}}}
await walk(root);
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}else console.log(`Verified ${count} bilingual messages, ICU parameters and interface source coverage.`);
