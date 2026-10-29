import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {example} from '../domain.mjs';

test('admin completes author and reviewer workflows alone with confirmation and audit preserved',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'carebridge-admin-'));let server;
 try {
  server=await createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;let cookie;
  const req=async(path,body)=>{const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const credentials={username:'manager',password:'Synthetic-test-password-2026!',name:'통합 관리자'};
  assert.equal((await req('setup',credentials)).status,201);cookie=(await req('login',credentials)).cookie;
  let result=await req('notes',{source:example,language:'en',privacy:true,caseId:'DEMO-A',topic:'care',demo:true});
  assert.equal(result.status,201);let n=result.data.note;assert.equal(n.assignee,'admin');
  const action=async body=>{const r=await req('notes/'+n.id,{version:n.version,...body});assert.equal(r.status,200,JSON.stringify(r.data));n=r.data.note;};
  await action({action:'answer',privacy:true,answers:n.clarifications.map(q=>({id:q.id,unknown:true}))});
  assert.equal((await req('notes/'+n.id,{action:'handoff',version:n.version,checked:false})).status,409);
  await action({action:'handoff',checked:true});
  const p=(await req('assistant',{message:'검토 시작',selectedNoteId:n.id})).data.proposal;assert.ok(p);
  assert.equal((await req('assistant',{message:'실행',proposalId:p.id})).data.changed,true);
  n=(await req('notes')).data.notes[0];assert.equal(n.status,'reviewing');
  await action({action:'revision',comment:'시점 확인'});
  await action({action:'resubmit',supplement:'Time is unknown.',privacy:true});
  await action({action:'review'});
  assert.equal((await req('notes/'+n.id,{action:'confirm',version:n.version,record:'가상 기록',comment:'확인',checked:false})).status,400);
  await action({action:'confirm',record:'가상 기록',comment:'원문 확인',checked:true});
  assert.equal(n.status,'confirmed');assert.ok(n.history.every(h=>h.actor==='통합 관리자'));
  await req('logout',{});assert.equal((await req('notes')).status,401);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
