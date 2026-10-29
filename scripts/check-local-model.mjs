import {translate} from '../ai.mjs';
import {writeFile} from 'node:fs/promises';
const samples=[
 {id:'en-negation',language:'en',source:'At lunch today, the resident ate half of the meal. The resident said they were not dizzy. No fall occurred.'},
 {id:'vi-meal',language:'vi',source:'Trưa nay, người được chăm sóc ăn khoảng một nửa suất ăn. Người đó nói không chóng mặt và không bị ngã.'},
 {id:'en-clarify',language:'en',source:'Today the resident ate less than usual.'},
 {id:'vi-evening',language:'vi',source:'Tối nay, người được chăm sóc uống một cốc nước. Tôi đã báo cho nhân viên phụ trách. Không rõ lượng nước chính xác.'},
 {id:'en-answer',language:'en',source:'Today the resident ate less than usual.\nQuestion: How much did they eat?\nAnswer: About one quarter of dinner. The reason is unknown.'}
];
const results=[];
for(const s of samples){const start=Date.now();try {results.push({...s,seconds:(await (async()=>{s.result=await translate(s.source,s.language);return Date.now()-start;})())/1000,result:s.result});}catch(e){results.push({...s,error:e.message,seconds:(Date.now()-start)/1000});}console.log(s.id,JSON.stringify(results.at(-1)));}
await writeFile(new URL('../logs/qwen-validation.json',import.meta.url),JSON.stringify(results,null,2));
if(results.some(r=>r.error))process.exitCode=1;
