import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {hashPassword,verifyPassword,digest,passwordPolicy} from './clover-base/lib/auth.mjs';
import {fail} from './domain.mjs';
const slots={admin:'admin',writer:'writer',reviewer:'reviewer',social:'reviewer'};
const publicAccount=a=>({id:a.id,name:a.name,username:a.username,role:a.role});
export async function accountsService(dataDir,initialAccounts=[]){
 const path=resolve(dataDir,'accounts.json');let accounts=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):[];
 const sessions=new Map(),limits=new Map();let creating=false;
 const save=next=>{writeFileSync(path+'.tmp',JSON.stringify(next,null,2),{mode:0o600});renameSync(path+'.tmp',path);accounts=next;};
 function limit(key,max=10){const now=Date.now();for(const [k,v]of limits)if(v.until<=now)limits.delete(k);const entry=limits.get(key)||{count:0,until:now+60000};if(entry.count>=max)throw fail('시도가 너무 많습니다. 1분 후 다시 시도해 주세요.',429);entry.count++;limits.set(key,entry);}
 const parse=b=>{if(typeof b.username!=='string'||!/^[a-zA-Z0-9._-]{3,40}$/.test(b.username))throw fail('아이디는 영문·숫자·점·밑줄·하이픈 3~40자로 입력해 주세요.');if(typeof b.name!=='string'||!b.name.trim()||b.name.length>50)throw fail('표시 이름을 1~50자로 입력해 주세요.');try{passwordPolicy(b.password);}catch(e){throw fail(e.message);}return {username:b.username.toLowerCase(),name:b.name.trim()};};
 async function create(b,id){if(creating)throw fail('다른 계정을 저장 중입니다. 다시 시도해 주세요.',409);creating=true;try{const data=parse(b);if(!Object.hasOwn(slots,id)||accounts.some(a=>a.id===id))throw fail('이미 등록된 역할이거나 잘못된 역할입니다.',409);if(accounts.some(a=>a.username===data.username))throw fail('이미 사용 중인 아이디입니다.',409);const passwordHash=await hashPassword(b.password);const account={...data,id,role:slots[id],passwordHash,createdAt:new Date().toISOString()};save([...accounts,account]);return publicAccount(account);}finally{creating=false;}}
 for(const a of initialAccounts)if(!accounts.some(x=>x.id===a.id))await create(a,a.id);
 function actor(token){if(!token)return null;const key=digest(token),s=sessions.get(key);if(!s||s.until<=Date.now()){sessions.delete(key);return null;}const a=accounts.find(a=>a.id===s.id);return a?{...publicAccount(a),expiresAt:s.until}:null;}
 function admin(user){if(user?.role!=='admin')throw fail('관리자만 사용할 수 있습니다.',403);}
 return {
  configured:()=>accounts.length>0,
  list(user){admin(user);return accounts.map(publicAccount);},
  staff:()=>accounts.filter(a=>a.role==='reviewer'||a.role==='admin').map(publicAccount),
  async setup(b,ip){limit('setup:'+ip,5);if(accounts.length)throw fail('초기 설정이 이미 완료됐습니다.',409);return create(b,'admin');},
  async create(b,user){admin(user);return create(b,b.slot);},
  async login(b,ip){limit('login:'+ip);const username=typeof b.username==='string'?b.username.toLowerCase():'';const a=accounts.find(a=>a.username===username);if(!a||!await verifyPassword(b.password,a.passwordHash))throw fail('아이디 또는 비밀번호가 올바르지 않습니다.',401);const token=randomBytes(32).toString('hex'),until=Date.now()+8*3600000;for(const[k,v]of sessions)if(v.until<=Date.now())sessions.delete(k);sessions.set(digest(token),{id:a.id,until});return {token,user:publicAccount(a)};},
  actor,
  logout(token){if(token)sessions.delete(digest(token));},
  logoutAll(user){for(const[k,v]of sessions)if(v.id===user.id)sessions.delete(k);},
  async change(b,user){limit('change:'+user.id,5);const before=accounts.find(a=>a.id===user.id);if(!await verifyPassword(b.currentPassword,before.passwordHash))throw fail('현재 비밀번호가 올바르지 않습니다.',400);try{passwordPolicy(b.password);}catch(e){throw fail(e.message);}const passwordHash=await hashPassword(b.password);if(accounts.find(a=>a.id===user.id).passwordHash!==before.passwordHash)throw fail('계정이 변경됐습니다. 다시 로그인해 주세요.',409);save(accounts.map(a=>a.id===user.id?{...a,passwordHash}:a));this.logoutAll(user);},
 };
}
