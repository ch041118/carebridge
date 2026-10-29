import {canEditElderNotes} from './elder-notes.mjs';
import {registrationConsent} from './consent.mjs';
import {careContact} from './sos.mjs';
import { randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { saveCaregiver } from './caregivers.mjs';
const scrypt=promisify(scryptCallback), DAY=86400000;
export const authError=(message,status=400)=>Object.assign(Error(message),{status});
const requiresApproval=role=>['social','caregiver'].includes(role);
export function ensureAuth(db){
 db.accounts||=[];db.sessions||=[];db.pairCodes||=[];db.accountApprovals||=[];
 for(const a of db.accounts)if(requiresApproval(a.role)&&a.approvalStatus!=='approved')a.approvalStatus='pending';
 const pending=new Set(db.accounts.filter(a=>requiresApproval(a.role)&&a.approvalStatus!=='approved').map(a=>a.id));
 db.sessions=db.sessions.filter(s=>!pending.has(s.userId));db.pairCodes=db.pairCodes.filter(p=>!pending.has(p.userId));
 for(const d of db.wellnessDevices||[])if(pending.has(d.userId)){d.token='';d.permission='denied';}
 return db;
}
export const isStaff=user=>(user.role==='admin'||(user.role==='social'&&user.approvalStatus==='approved'));
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function emailAddress(value){if(typeof value!=='string'||value.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw authError('이메일 주소를 확인해 주세요.');return value.trim().toLowerCase();}
export function passwordPolicy(password){if(typeof password!=='string'||password.length<12||password.length>128)throw authError('비밀번호는 12자 이상 128자 이하로 입력해 주세요.');}
let hashing=0;
async function derive(password,salt){if(hashing>=2)throw authError('로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);hashing++;try{return await scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});}finally{hashing--;}}
export async function hashPassword(password){passwordPolicy(password);const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${(await derive(password,salt)).toString('hex')}`;}
export async function verifyPassword(password,stored){if(typeof password!=='string'||password.length>128)return false;const parts=typeof stored==='string'&&/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);const salt=parts?parts[1]:'0'.repeat(32),key=parts?parts[2]:'0'.repeat(128);const value=await derive(password,salt);return timingSafeEqual(value,Buffer.from(key,'hex'))&&Boolean(parts);}
export const publicUser=user=>({id:user.id,name:user.name,email:user.email,role:user.role,approvalStatus:requiresApproval(user.role)?user.approvalStatus:undefined,caregiverId:user.caregiverId||null});
export function findSession(db,token,now=Date.now()){if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return null;const hash=digest(token),session=db.sessions.find(s=>s.hash===hash&&s.expiresAt>now);const account=session&&db.accounts.find(a=>a.id===session.userId&&!a.disabled&&(!requiresApproval(a.role)||a.approvalStatus==='approved'));return account?{...publicUser(account),role:session.role,elderId:session.elderId||null,sessionHash:session.hash,expiresAt:session.expiresAt}:null;}
function sessionFor(db,account,now,elderId=account.elderId){const token=randomBytes(32).toString('hex');db.sessions=db.sessions.filter(s=>s.expiresAt>now);const role=elderId?'elder':account.role;const expiresAt=now+(elderId?30:7)*DAY;db.sessions.push({hash:digest(token),userId:account.id,role,elderId:elderId||null,createdAt:now,expiresAt});return {token,expiresAt,user:{...publicUser(account),role,elderId:elderId||null}};}
export function ownsElder(db,user,id){return isStaff(user)||(user.role==='caregiver'&&user.approvalStatus==='approved'&&db.elders.some(e=>e.id===id&&e.ownerCaregiverId===user.caregiverId));}
export function canUseElder(db,user,id){if(user.role==='elder')return user.elderId===id;return ownsElder(db,user,id)||(user.role==='caregiver'&&db.requests.some(r=>r.elderId===id&&r.caregiverId===user.caregiverId));}
export function createAuthService({getDb,commit,geocode,clock=Date.now}){
  const limits=new Map();
  function limit(key,max,window=15*60000){const now=clock();for(const [k,v]of limits)if(v.until<=now)limits.delete(k);const entry=limits.get(key)||{count:0,until:now+window};if(entry.count>=max)throw authError('시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.',429);entry.count++;limits.set(key,entry);}
  function requireAdmin(user,db=getDb()){
    const actor=db.accounts.find(a=>a.id===user?.id&&!a.disabled);
    if(user?.role!=='admin'||actor?.role!=='admin')throw authError('관리자만 직원 가입을 승인할 수 있습니다.',403);
    return actor;
  }
  function listApprovals(user,role){requireAdmin(user);return {accounts:getDb().accounts.filter(a=>a.role===role&&!a.disabled).map(a=>({id:a.id,name:a.name,email:a.email,role:a.role,status:a.approvalStatus||'pending',createdAt:a.createdAt,approvedAt:a.approvedAt||null,approvedBy:a.approvedBy||null}))};}
  function approve(user,id,role){requireAdmin(user);return commit(db=>{
    const actor=requireAdmin(user,db),account=db.accounts.find(a=>a.id===id&&a.role===role&&!a.disabled);
    if(!account)throw authError('가입 신청을 찾을 수 없습니다.',404);
    if(account.approvalStatus!=='approved'){account.approvalStatus='approved';account.approvedAt=clock();account.approvedBy=actor.id;db.accountApprovals||=[];db.accountApprovals.push({userId:id,adminId:actor.id,role,action:'approved',at:clock()});}
    return {approved:true,id:account.id,approvedAt:account.approvedAt};
  });}
  return {
    socialApprovals(user){return listApprovals(user,'social');},
    caregiverApprovals(user){return listApprovals(user,'caregiver');},
    approveSocial(user,id){return approve(user,id,'social');},
    approveCaregiver(user,id){return approve(user,id,'caregiver');},
    async register(body,ip){
      limit('ip:'+ip,30);const email=emailAddress(body.email);limit('email:'+email,10);
      const role=body.role||'caregiver';if(!['caregiver','social','elder'].includes(role))throw authError('가입 유형을 확인해 주세요.',403);
      if(getDb().accounts.some(a=>a.email===email))throw authError('이미 가입된 이메일입니다. 로그인해 주세요.',409);
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>50)throw authError('성함을 입력해 주세요.');
      const consent=registrationConsent(body,{proxyRequired:role==='elder',now:clock()});
      passwordPolicy(body.password);
      let profile;
      if(role==='caregiver')profile=await saveCaregiver({caregivers:[]},{...body,id:undefined},{geocode});
      if(role==='elder'){
        for(const key of ['address','contact'])if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>200)throw authError('주소와 보호자 연락처를 입력해 주세요.');
        const coords=await geocode(body.address.trim());
        if(coords.locationVerified!==false&&(!Number.isFinite(coords.lat)||!Number.isFinite(coords.lng)||Math.abs(coords.lat)>90||Math.abs(coords.lng)>180))throw authError('주소의 위치를 확인하지 못했습니다.');
        profile={id:randomUUID(),name:body.name.trim(),address:body.address.trim(),contact:body.contact.trim(),ownerCaregiverId:null,...coords,createdAt:clock()};
      }
      const passwordHash=await hashPassword(body.password);
      return commit(db=>{
        if(db.accounts.some(a=>a.email===email))throw authError('이미 가입된 이메일입니다.',409);
        const account={id:randomUUID(),email,name:body.name.trim(),role,passwordHash,createdAt:clock(),consent};
        if(role==='caregiver'){account.caregiverId=profile.id;db.caregivers.push(profile);}
        if(role==='elder'){account.elderId=profile.id;db.elders.push(profile);}
        if(requiresApproval(role))account.approvalStatus='pending';
        db.accounts.push(account);if(requiresApproval(role))return {pendingApproval:true,message:'가입 신청을 접수했습니다. 관리자 승인 후 로그인할 수 있습니다.'};return sessionFor(db,account,clock());
      });
    },
    async login(body,ip){limit('ip:'+ip,60);const email=body.email==='admin'?'admin':emailAddress(body.email);limit('email:'+email,10);const account=getDb().accounts.find(a=>a.email===email);const valid=await verifyPassword(body.password,account?.passwordHash);if(!valid||!account||account.disabled)throw authError('이메일 또는 비밀번호가 일치하지 않습니다.',401);return commit(db=>{const current=db.accounts.find(a=>a.id===account.id);if(current.disabled||current.passwordHash!==account.passwordHash)throw authError('다시 로그인해 주세요.',401);if(requiresApproval(current.role)&&current.approvalStatus!=='approved')throw authError('관리자 승인 대기 중입니다. 승인 후 로그인해 주세요.',403);limits.delete('email:'+email);return sessionFor(db,current,clock());});},
    logout(user){return commit(db=>{db.sessions=db.sessions.filter(s=>s.hash!==user.sessionHash);for(const d of db.wellnessDevices||[])if(d.sessionHash===user.sessionHash){d.token='';d.permission='denied';}return {loggedOut:true};});},
    async changePassword(user,body){if(user.role==='elder'&&getDb().accounts.find(a=>a.id===user.id)?.role!=='elder')throw authError('담당자 계정에서 변경해 주세요.',403);limit('password:'+user.id,10);const account=getDb().accounts.find(a=>a.id===user.id);if(!await verifyPassword(body.currentPassword,account.passwordHash))throw authError('현재 비밀번호가 일치하지 않습니다.',401);const next=await hashPassword(body.password);return commit(db=>{const current=db.accounts.find(a=>a.id===user.id);if(current.passwordHash!==account.passwordHash)throw authError('다시 로그인해 주세요.',401);current.passwordHash=next;db.sessions=db.sessions.filter(s=>s.userId!==user.id);db.pairCodes=db.pairCodes.filter(s=>s.userId!==user.id);for(const d of db.wellnessDevices||[])if(d.userId===user.id){d.token='';d.permission='denied';}return {changed:true};});},
    pairCode(user,elderId){if(!getDb().elders.some(e=>e.id===elderId)||!ownsElder(getDb(),user,elderId))throw authError('직접 등록한 어르신만 연결할 수 있습니다.',403);const code=String(randomInt(0,1000000)).padStart(6,'0');return commit(db=>{db.pairCodes=db.pairCodes.filter(p=>p.expiresAt>clock()&&p.elderId!==elderId);if(db.pairCodes.some(p=>p.hash===digest(code)))throw authError('연결 코드를 다시 발급해 주세요.');db.pairCodes.push({hash:digest(code),elderId,userId:user.id,expiresAt:clock()+10*60000});return {code,expiresAt:clock()+10*60000};});},
    pair(body,ip){limit('pair:'+ip,5);if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code))throw authError('6자리 연결 코드를 입력해 주세요.');return commit(db=>{const p=db.pairCodes.find(p=>p.hash===digest(body.code)&&p.expiresAt>clock());const user=p&&db.accounts.find(a=>a.id===p.userId&&!a.disabled&&(!requiresApproval(a.role)||a.approvalStatus==='approved'));if(!user)throw authError('연결 코드가 만료되었거나 일치하지 않습니다.',401);db.pairCodes=db.pairCodes.filter(c=>c!==p);db.sessions=db.sessions.filter(s=>!(s.role==='elder'&&s.elderId===p.elderId));for(const d of db.wellnessDevices||[])if(d.role==='elder'&&d.elderId===p.elderId){d.permission='denied';d.token='';}return sessionFor(db,user,clock(),p.elderId);});}
  };
}
export function authorize(db,user,path,body={}){
  if(!user)throw authError('로그인이 필요합니다.',401);
  if(requiresApproval(user.role)&&user.approvalStatus!=='approved')throw authError('관리자 승인이 필요합니다.',403);
  if(['auth/approve-social','auth/approve-caregiver'].includes(path)){if(user.role!=='admin')throw authError('관리자만 승인할 수 있습니다.',403);return;}
  const forbid=()=>{throw authError('이 작업을 수행할 권한이 없습니다.',403);};
  if(['auth/logout','auth/password','auth/pair-code'].includes(path))return;
  if(['sos','voice','voice-json','wellness/activity','wellness/reply','demo-request'].includes(path)){
    if(!canUseElder(db,user,body.elderId))forbid();
    if(path==='wellness/reply'&&!db.checkins.some(c=>c.id===body.id&&c.elderId===body.elderId))forbid();
    if(body.checkinId&&!db.checkins.some(c=>c.id===body.checkinId&&c.elderId===body.elderId))forbid();return;
  }
  if(path==='wellness/device'){if(body.role!==user.role||(user.role==='elder'&&body.elderId!==user.elderId))forbid();const d=db.wellnessDevices.find(d=>d.id===body.id);if(d&&d.userId!==user.id&&(d.permission!=='denied'||d.token))forbid();return;}
  if(path==='wellness/device-disable'){const d=db.wellnessDevices.find(d=>d.id===body.id);if(d&&d.userId!==user.id)forbid();return;}
  if(user.role==='elder')forbid();
  if(path==='caregivers'||path==='availability'){if(!body.id||!db.caregivers.some(c=>c.id===body.id))forbid();if(!isStaff(user)&&body.id!==user.caregiverId)forbid();return;}
  if(path==='elders')return;
  if(path==='elder-notes'){if(!canEditElderNotes(db,user,body.id))forbid();return;}
  if(path==='resolve-candidates'){if(!isStaff(user))forbid();return;}
  if(path==='voice-recording'){if(!isStaff(user))forbid();return;}
  if(path==='sos/resolve'){const r=db.requests.find(r=>r.id===body.id&&r.urgency==='sos');if(!r||(!isStaff(user)&&!(user.role==='caregiver'&&r.caregiverId===user.caregiverId)))forbid();return;}
  if(path==='action'){const r=db.requests.find(r=>r.id===body.id);if(!r)forbid();if(body.action==='resolve'){if(!isStaff(user))forbid();}else if(user.role!=='caregiver'||r.caregiverId!==user.caregiverId)forbid();return;}
  if(['wellness/resolve','wellness/settings','wellness/demo'].includes(path)&&isStaff(user))return;
  forbid();
}
export function scopedState(db,user){
  if(requiresApproval(user.role)&&user.approvalStatus!=='approved')throw authError('관리자 승인이 필요합니다.',403);
  const social=isStaff(user);
  const requests=db.requests.filter(r=>social||(user.role==='elder'?r.elderId===user.elderId:r.caregiverId===user.caregiverId));
  const elders=db.elders.filter(e=>social||canUseElder(db,user,e.id)).map(({notesHistory,...e})=>{if(user.role==='elder'){const {specialNotes,precautions,notesRevision,notesUpdatedAt,notesUpdatedBy,...safe}=e;return safe;}return {...e,notesEditable:canEditElderNotes(db,user,e.id)};});
  const ids=new Set(elders.map(e=>e.id));
  const caregivers=db.caregivers.filter(c=>social||c.id===user.caregiverId||requests.some(r=>r.caregiverId===c.id)).map(c=>user.role==='elder'?{id:c.id,name:c.name}:c);
  return {careContact:user.role==='elder'?careContact(db,user.elderId):null,caregivers,elders,requests,checkins:db.checkins.filter(c=>social||ids.has(c.elderId)),wellnessSettings:db.wellnessSettings,wellnessDevices:social?db.wellnessDevices.map(({token,sessionHash,userId,...d})=>d):[],wellnessOutbox:[],auth:{user:{id:user.id,name:user.name,role:user.role,approvalStatus:user.approvalStatus,email:user.role==='elder'?undefined:user.email,caregiverId:user.role==='caregiver'?user.caregiverId:null,elderId:user.elderId},expiresAt:user.expiresAt}};
}
