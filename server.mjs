import {accountsService} from './accounts.mjs';
import {staff,cases,topics,routing,visible,questions,answerInput,handoff} from './workflow.mjs';
import http from 'node:http';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';


import {lockDataDirectory} from './clover-base/lib/data-lock.mjs';
import {example,fixture,validateInput,createNote,transition,fail} from './domain.mjs';
import {translate} from './ai.mjs';
import {assistantService} from './assistant.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export async function createApp({dataDir=resolve(root,'data'),translator=translate,initialAccounts=[],chatPlanner,publicOrigin=''}={}){
 const external=publicOrigin?new URL(publicOrigin):null;
 if(external&&(external.protocol!=='https:'||external.origin!==publicOrigin||external.username||external.password))throw Error('Public origin must be an exact HTTPS origin.');
 mkdirSync(dataDir,{recursive:true});const release=lockDataDirectory(dataDir),file=resolve(dataDir,'notes.json');
 let notes=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
 const accounts=await accountsService(dataDir,initialAccounts);
 const save=next=>{writeFileSync(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});renameSync(file+'.tmp',file);notes=next;};
 const commit=(id,body,user)=>{
  const next=structuredClone(notes),note=next.find(n=>n.id===id);
  if(!note||!visible(note,user)||user.role!=='reviewer')throw fail('열람 가능한 담당 기록이 아닙니다.',403);
  if(body.version!==note.version)throw fail('기록이 변경됐습니다. 다시 열고 요청해 주세요.',409);
  if(body.action==='reassign'){
   const staff=accounts.staff();
   if(note.status==='confirmed')throw fail('확정 기록은 재배정할 수 없습니다.',409);
   if(!staff.some(s=>s.id===body.assignee)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)throw fail('담당자와 사유를 확인해 주세요.');
   note.assignee=body.assignee;note.routeReason='담당자 재배정: '+body.reason.trim();note.status='pending';note.version++;
   note.history.push({at:new Date().toISOString(),actor:user.name,event:'담당자 재배정',version:note.version,comment:body.reason+' → '+staff.find(s=>s.id===body.assignee).name});
  }else transition(note,body,user);
  save(next);return note;
 };
 const chat=assistantService({getNotes:()=>notes,getStaff:()=>accounts.staff(),commit,planner:chatPlanner});
 const server=http.createServer(async(req,res)=>{
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  try{
   const host=req.headers.host;if(external?host!==external.host:!/^(127\.0\.0\.1|localhost):\d+$/.test(host||''))throw fail('허용되지 않은 주소입니다.',403);
   const url=new URL(req.url,'http://'+host);
   if(req.method!=='GET'&&req.headers.origin!==(external?external.origin:`http://${host}`))throw fail('동일한 앱 화면에서 요청해 주세요.',403);
   if(external&&url.pathname==='/api/setup')throw fail('외부 시연에서는 초기 설정을 사용할 수 없습니다.',403);
   let body={};if(req.method==='POST'){if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSON 요청이 필요합니다.',415);let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>64000)throw fail('요청이 너무 큽니다.',413);}try{body=JSON.parse(text);}catch{throw fail('잘못된 요청입니다.');}}
   if(url.pathname==='/api/health'&&req.method==='GET')return json(200,{app:'carebridge',version:'0.2.0'});
   if(url.pathname==='/api/setup-status'&&req.method==='GET')return json(200,{configured:accounts.configured()});
   if(url.pathname==='/api/setup'&&req.method==='POST')return json(201,{user:await accounts.setup(body,req.socket.remoteAddress)});
   if(url.pathname==='/api/login'&&req.method==='POST'){
    const result=await accounts.login(body,req.socket.remoteAddress);res.setHeader('Set-Cookie',`carebridge=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${external?'; Secure':''}`);return json(200,{user:result.user});
   }
   if(url.pathname.startsWith('/api/')){
    const token=/carebridge=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1],user=accounts.actor(token);if(!user)throw fail('로그인이 만료되었습니다. 다시 로그인해 주세요.',401);
    if(['/api/logout','/api/logout-all'].includes(url.pathname)&&req.method==='POST'){if(url.pathname==='/api/logout-all')accounts.logoutAll(user);else accounts.logout(token);res.setHeader('Set-Cookie','carebridge=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{});}
    if(url.pathname==='/api/password'&&req.method==='POST'){await accounts.change(body,user);res.setHeader('Set-Cookie','carebridge=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{});}
    if(url.pathname==='/api/accounts'&&req.method==='GET')return json(200,{accounts:accounts.list(user)});
    if(url.pathname==='/api/accounts'&&req.method==='POST')return json(201,{user:await accounts.create(body,user)});
    const staff=accounts.staff();
    if(url.pathname==='/api/assistant'&&req.method==='POST')return json(200,await chat({body,user,token,active:()=>Boolean(accounts.actor(token))}));
    if(url.pathname==='/api/directory'&&req.method==='GET')return json(200,{staff,cases,topics});
    if(url.pathname==='/api/me')return json(200,{user,aiConfigured:Boolean(process.env.OLLAMA_MODEL)});
    if(url.pathname==='/api/notes'&&req.method==='GET')return json(200,{notes:notes.filter(n=>visible(n,user))});
    if(url.pathname==='/api/notes'&&req.method==='POST'){
     if(user.role!=='writer')throw fail('작성자 계정에서 입력해 주세요.',403);const input={...validateInput(body),...routing(body)};if(!staff.some(s=>s.id===input.assignee))throw fail('관리자가 먼저 해당 업무 담당자 계정을 등록해야 합니다.',409);
     if(body.demo===true&&(input.source!==example||input.language!=='en'))throw fail('예시 체험은 제공된 영어 메모만 사용할 수 있습니다.');
     const draft=body.demo===true?fixture():await translator(input.source,input.language);if(!accounts.actor(token))throw fail('로그인이 만료됐습니다. 메모를 다시 제출해 주세요.',401);const note=createNote(input,draft,user,body.demo===true?'example':'ai');
     if(body.demo===true){draft.authorSummary=example;draft.followups=[{ko:'식사량이 적었다는 뜻인가요, 먹는 데 어려움이 있었다는 뜻인가요?',native:'Do you mean a smaller amount was eaten, or that eating was difficult?'},{ko:'관찰 시점과 이후 조치를 아는 범위에서 알려 주세요.',native:'When was this observed and what action followed? Select unknown if unsure.'}];}
     note.clarifications=questions(draft);note.status=note.clarifications.length?'clarifying':'ready';save([...notes,note]);return json(201,{note});
    }
    const m=/^\/api\/notes\/([a-f0-9-]+)$/.exec(url.pathname);if(m&&req.method==='POST'){if(user.role==='reviewer'&&['review','revision','confirm','reassign'].includes(body.action))return json(200,{note:commit(m[1],body,user)});const next=structuredClone(notes),note=next.find(n=>n.id===m[1]);if(!note)throw fail('기록을 찾을 수 없습니다.',404);if(!visible(note,user))throw fail('열람 권한이 없습니다.',403);
     if(body.action==='answer'){
      const answers=answerInput(note,body,user),combined=note.source+'\n\n'+answers.map(q=>'Question: '+q.native+'\nAnswer: '+(q.unknown?'Unknown / not observed':q.answer)).join('\n');
      const updated=note.mode==='example'?{...note.draft,followups:[],authorSummary:combined}:await translator(combined,note.language);
      if(!accounts.actor(token))throw fail('로그인이 만료됐습니다. 다시 제출해 주세요.',401);const current=structuredClone(notes),fresh=current.find(n=>n.id===note.id);
      if(fresh.version!==body.version||fresh.status!=='clarifying')throw fail('답변 처리 중 기록이 변경됐습니다. 새로고침해 주세요.',409);
      fresh.draftVersions||=[];fresh.draftVersions.push({draft:fresh.draft,version:fresh.version});fresh.clarifications=answers;fresh.draft=updated;fresh.status='ready';fresh.version++;
      fresh.unresolved=answers.filter(q=>q.unknown).map(q=>q.ko);
      if(note.mode==='example')fresh.unresolved.push('고정 예시: 답변은 자동 번역하지 않습니다. 담당자는 답변 원문을 확인해야 합니다.');
      else fresh.unresolved.push(...(updated.followups||[]).map(q=>q.ko));
      fresh.history.push({at:new Date().toISOString(),actor:user.name,event:'재질문 답변 및 초안 보완',version:fresh.version});save(current);return json(200,{note:fresh});
     }
     if(body.action==='handoff')handoff(note,body,user);
     else if(body.action==='reassign'){
      if(user.role!=='reviewer'||note.status==='confirmed'||body.version!==note.version)throw fail('재배정할 수 없는 상태입니다.',409);
      if(!staff.some(s=>s.id===body.assignee)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)throw fail('담당자와 재배정 사유를 입력해 주세요.');
      note.assignee=body.assignee;note.routeReason='담당자 재배정: '+body.reason.trim();note.status='pending';note.version++;note.history.push({at:new Date().toISOString(),actor:user.name,event:'담당자 재배정',version:note.version,comment:body.reason+' → '+staff.find(s=>s.id===body.assignee).name});
     }else transition(note,body,user);save(next);return json(200,{note});}
    throw fail('경로를 찾을 수 없습니다.',404);
   }
   const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};const f=files[url.pathname];if(req.method!=='GET'||!f)throw fail('페이지를 찾을 수 없습니다.',404);res.writeHead(200,{'Content-Type':f[1]+'; charset=utf-8'});res.end(readFileSync(resolve(root,'public',f[0])));
  }catch(e){json(e.status||500,{error:e.status?e.message:'저장 또는 처리에 실패했습니다. 다시 확인해 주세요.'});}
 });server.on('close',release);return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const app=await createApp();app.listen(Number(process.env.PORT||3100),'127.0.0.1',()=>console.log(`CareBridge: http://127.0.0.1:${app.address().port}`));}
