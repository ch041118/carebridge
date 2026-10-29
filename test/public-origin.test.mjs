import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createApp} from '../server.mjs';
test('external preview enforces exact host and HTTPS origin, disables setup, secures cookies',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'carebridge-preview-'));let server;
 try{
  const origin='https://preview.example.test';
  server=await createApp({dataDir:dir,publicOrigin:origin,initialAccounts:[{id:'writer',username:'writer',name:'가상 작성자',password:'Test-only-2026!'}]});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const call=(path,body,requestOrigin=origin)=>new Promise((resolve,reject)=>{const q=http.request(base+path,{method:body?'POST':'GET',headers:{Host:'preview.example.test',Origin:requestOrigin,'Content-Type':'application/json'}},r=>{r.resume();r.on('end',()=>resolve({status:r.statusCode,headers:{get:n=>(r.headers[n]||[]).toString()}}));});q.on('error',reject);q.end(body?JSON.stringify(body):undefined);});
  assert.equal((await fetch(base+'/api/health')).status,403);
  assert.equal((await call('/api/health')).status,200);
  assert.equal((await call('/api/setup',{})).status,403);
  assert.equal((await call('/api/login',{username:'writer',password:'Test-only-2026!'},'https://evil.test')).status,403);
  const r=await call('/api/login',{username:'writer',password:'Test-only-2026!'});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/; Secure/);
 }finally{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
