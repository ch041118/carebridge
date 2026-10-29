import {translate} from '../ai.mjs';
import {routing} from '../workflow.mjs';
import {cases} from './model-evaluation-cases.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const out=new URL('../evaluation/',import.meta.url);
await mkdir(out,{recursive:true});
const results=[];
for(const c of cases){
 const row={...c,route:routing({caseId:'DEMO-A',topic:c.topic}),runs:[]};
 for(const phase of ['initial','answered']){
  const source=phase==='initial'?c.source:c.source+'\n\nQuestion: '+c.question+'\nAnswer: '+c.answer;
  const start=performance.now();
  try{const result=await translate(source,c.language);row.runs.push({phase,seconds:+((performance.now()-start)/1000).toFixed(2),result});}
  catch(e){row.runs.push({phase,seconds:+((performance.now()-start)/1000).toFixed(2),error:e.message});}
 }
 results.push(row);
 const report={model:process.env.OLLAMA_MODEL,at:new Date().toISOString(),promptSHA256:createHash('sha256').update(readFileSync(new URL('../ai.mjs',import.meta.url))).digest('hex'),method:'24 synthetic cases x initial and fixed Q&A; no real records, no adaptive answers, format success does not imply semantic correctness',results};
 await writeFile(new URL('qwen-results.json',out),JSON.stringify(report,null,2));
 console.log(c.id,row.runs.map(r=>r.error?'ERROR: '+r.error:r.seconds+'s / questions:'+r.result.followups.length).join(' | '));
 }
const success=results.flatMap(r=>r.runs).filter(r=>!r.error);
console.log(JSON.stringify({calls:results.length*2,formatSuccess:success.length,errors:results.length*2-success.length,meanSeconds:success.reduce((s,r)=>s+r.seconds,0)/success.length}));
