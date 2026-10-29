import { seoulDay } from './scheduler.mjs';
export const FIVE_MINUTES = 5 * 60000;
export const DEFAULT_WELLNESS = { enabled: true, hour: 19, minute: 0, maxAttempts: 3, intervalMinutes: 5 };
export function ensureWellness(db) {
  db.wellnessSettings ||= { ...DEFAULT_WELLNESS };
  db.checkins ||= []; db.wellnessOutbox ||= []; db.wellnessDevices ||= [];
  return db;
}
const log = (item, message, now) => item.events.push({ at: now, message });
const todayStart = (day, settings) => Date.parse(`${day}T${String(settings.hour).padStart(2,'0')}:${String(settings.minute).padStart(2,'0')}:00+09:00`);
export const needsAttention = item => Boolean(item.attentionAt && !item.resolvedAt);
export const awaitingReply = item => !item.respondedAt && !item.resolvedAt && ['waiting','escalated','delivery_failed'].includes(item.status);
export function getActiveCheckin(db, elderId) {
  ensureWellness(db);
  return db.checkins.find(c => !c.simulation && c.elderId === elderId && awaitingReply(c));
}
function cancelReminders(db, item) {
  for (const job of db.wellnessOutbox) if (job.checkinId === item.id && job.kind === 'reminder' && job.status === 'pending') job.status = 'cancelled';
  item.pendingDelivery = null; item.nextAt = null;
}
function staffNotice(db, item, reason, now) {
  if (item.simulation) return;
  const id = `staff:${item.id}:${reason}`;
  if (!db.wellnessOutbox.some(job => job.id === id)) db.wellnessOutbox.push({ id, kind:'staff', checkinId:item.id, status:'pending', createdAt:now, expiresAt:now+86400000, title:'클로버 · 안부 확인', body:reason==='reply'?'확인이 필요한 안부 요청에 새 답변이 도착했어요. 앱에서 확인해 주세요.':'확인이 필요한 안부 요청이 있어요. 앱에서 확인해 주세요.' });
}
function flag(db, item, status, reason, now) {
  item.status = status; item.attentionAt ||= now; item.reason = reason;
  cancelReminders(db,item); log(item,reason,now); staffNotice(db,item,'attention',now);
}
function createCheckin(db, elderId, now, simulation=false) {
  const day = seoulDay(now), policy = {...db.wellnessSettings};
  const start = simulation ? now : todayStart(day,policy);
  const item = { id:simulation?`demo-${crypto.randomUUID()}`:`${elderId}:${day}`, elderId, day, simulation, policy, scheduledAt:start, createdAt:now, status:'waiting', attempts:[], nextAt:now, events:[] };
  db.checkins.unshift(item); log(item,simulation?'안부 확인 체험 시작 · 실제 알림은 보내지 않습니다.':'오늘 앱 사용 기록이 없어 안부 확인을 시작했습니다.',now);
  return item;
}
export function markElderActivity(db, elderId, now=Date.now()) {
  ensureWellness(db);
  const elder=db.elders.find(e=>e.id===elderId); if(!elder)throw Error('어르신을 찾을 수 없습니다.');
  elder.lastActiveAt=now;
  // Opening a prompt is not a reply. Polling must never call this function.
  return { lastActiveAt:now, checkin:getActiveCheckin(db,elderId) || null };
}
export function hasRequestToday(db,elderId,now=Date.now()) {
  const day=seoulDay(now);
  return (db.requests||[]).some(r=>r.elderId===elderId&&!r.demo&&Number.isFinite(r.createdAt)&&r.createdAt<=now&&seoulDay(r.createdAt)===day);
}
function skipForRequests(db,elderIds,now) {
  let changed=false;
  for(const item of db.checkins){
    if(item.simulation||!elderIds.has(item.elderId)||!awaitingReply(item))continue;
    item.status='skipped';item.skipReason='care-request';cancelReminders(db,item);
    // Keep any already raised concern for staff review; a request is not a claim of wellbeing.
    log(item,'오늘 돌봄 요청이 접수되어 출석·안부 확인을 생략했습니다.',now);
    changed=true;
  }
  return changed;
}
export function markElderRequest(db,elderId,now=Date.now()) {
  const result=markElderActivity(db,elderId,now);
  if(hasRequestToday(db,elderId,now))skipForRequests(db,new Set([elderId]),now);
  return {...result,checkin:getActiveCheckin(db,elderId)||null};
}
export function updateWellnessSettings(db, input, now=Date.now()) {
  ensureWellness(db);
  if(typeof input.enabled!=='boolean'||!Number.isInteger(input.hour)||input.hour<17||input.hour>21||!Number.isInteger(input.minute)||input.minute<0||input.minute>59||!Number.isInteger(input.maxAttempts)||input.maxAttempts<1||input.maxAttempts>5)throw Error('안부 시간은 17~21시, 알림 횟수는 1~5회로 설정해 주세요.');
  db.wellnessSettings={enabled:input.enabled,hour:input.hour,minute:input.minute,maxAttempts:input.maxAttempts,intervalMinutes:5};
  if(!input.enabled) for(const item of db.checkins) if(item.status==='waiting'&&!item.simulation){item.status='cancelled';cancelReminders(db,item);log(item,'담당자가 안부 확인을 비활성화했습니다.',now);}
  return db.wellnessSettings;
}
export function tickWellness(db, now=Date.now(), onChange=()=>{}) {
  ensureWellness(db); const day=seoulDay(now), settings=db.wellnessSettings;
  let changed=false;
  const requestedToday=new Set((db.requests||[]).filter(r=>!r.demo&&Number.isFinite(r.createdAt)&&r.createdAt<=now&&seoulDay(r.createdAt)===day).map(r=>r.elderId));
  if(skipForRequests(db,requestedToday,now))changed=true;
  const seenToday=new Set(db.checkins.filter(c=>!c.simulation&&c.day===day).map(c=>c.elderId));
  const unresolved=new Set(db.checkins.filter(c=>!c.simulation&&(needsAttention(c)||awaitingReply(c))).map(c=>c.elderId));
  if(settings.enabled && now>=todayStart(day,settings)) for(const elder of db.elders) {
    if(elder.wellnessEnabled===false||seenToday.has(elder.id))continue;
    // Do not stack a second unresolved check-in on the following day.
    if(unresolved.has(elder.id))continue;
    const item=createCheckin(db,elder.id,now);
    changed=true;seenToday.add(elder.id);
    if(requestedToday.has(elder.id)){item.status='skipped';item.skipReason='care-request';item.nextAt=null;log(item,'오늘 돌봄 요청이 접수되어 출석·안부 확인을 생략했습니다.',now);}
    else if(elder.lastActiveAt&&seoulDay(elder.lastActiveAt)===day){item.status='skipped';item.nextAt=null;log(item,'오늘 앱을 사용하여 안부 알림을 생략했습니다.',now);}
    else if(now>item.scheduledAt+2*3600000)flag(db,item,'delivery_failed','서버 확인이 늦어 안부 알림 시간을 놓쳤습니다. 직접 확인해 주세요.',now);
  }
  for(const item of db.checkins) {
    if(item.simulation||item.status!=='waiting')continue;
    if(now>item.scheduledAt+2*3600000){flag(db,item,'delivery_failed','안부 알림 처리 시간이 지나 직접 확인이 필요합니다.',now);changed=true;continue;}
    if(item.pendingDelivery||now<item.nextAt)continue;
    if(item.attempts.length>=item.policy.maxAttempts){flag(db,item,'escalated',`${item.policy.maxAttempts}회 알림 발송 접수 후 응답이 없습니다. 어르신께 직접 연락해 주세요.`,now);changed=true;continue;}
    const number=item.attempts.length+1,id=`reminder:${item.id}:${number}`;
    if(db.wellnessOutbox.some(job=>job.id===id))continue;
    db.wellnessOutbox.push({id,kind:'reminder',checkinId:item.id,elderId:item.elderId,number,status:'pending',createdAt:now,expiresAt:now+FIVE_MINUTES,title:'클로버가 안부를 여쭤요',body:number===1?'저녁은 드셨어요? 오늘 하루는 어떠셨나요? 편하게 안부를 들려주세요.':'잘 지내고 계신가요? 괜찮으시면 클로버에 짧게 답해 주세요.'});
    item.pendingDelivery=id;
    changed=true;
  }
  if(changed)onChange();
  return db;
}
export function completeDelivery(db, jobId, result, now=Date.now()) {
  const job=db.wellnessOutbox.find(j=>j.id===jobId); if(!job||['sent','failed','cancelled'].includes(job.status))return;
  const item=db.checkins.find(c=>c.id===job.checkinId);
  job.status=result.ok?'sent':'failed';job.finishedAt=now;job.error=result.ok?null:(result.error||'알림 발송을 확인할 수 없습니다.');
  if(job.kind==='sos'){const request=db.requests.find(r=>r.id===job.checkinId);if(request)request.sosDelivery=job.status;return;}
  if(job.kind==='staff')return;
  item.pendingDelivery=null;
  if(item.status!=='waiting')return;
  if(!result.ok){flag(db,item,'delivery_failed',`알림 전송 확인 필요: ${job.error}`,now);return;}
  item.attempts.push({number:job.number,at:now,transport:'push',result:'provider_accepted'});
  item.nextAt=now+FIVE_MINUTES;log(item,`${job.number}회차 알림을 푸시 서비스가 접수했습니다. 기기 표시 여부는 확인되지 않았습니다.`,now);
}
export function replyCheckin(db, input, now=Date.now()) {
  ensureWellness(db);
  const item=db.checkins.find(c=>c.id===input.id&&c.elderId===input.elderId);
  if(!item)throw Error('안부 확인 요청을 찾을 수 없습니다.');
  if(item.respondedAt)return item; // Retried acknowledgements are idempotent.
  if(!awaitingReply(item))throw Error('이미 처리된 안부 확인입니다.');
  if(!['okay','review'].includes(input.outcome))throw Error('안부 응답을 확인해 주세요.');
  const text=String(input.text||'잘 지내요').trim().slice(0,1000);
  if(!text)throw Error('안부 답변이 비어 있습니다.');
  if(item.simulation)now=Math.max(now,...item.events.map(e=>e.at+1));
  item.respondedAt=now;item.response=text;item.outcome=input.outcome;
  item.status=input.outcome==='okay'?'responded':'review'; cancelReminders(db,item);
  const elder=db.elders.find(e=>e.id===item.elderId);if(elder&&!item.simulation)elder.lastActiveAt=now;
  log(item,`어르신 답변: ${text}`,now);
  if(input.outcome==='review'){item.attentionAt ||= now;item.reason='어르신의 안부 답변을 담당자가 확인해야 합니다.';staffNotice(db,item,'reply',now);}
  else if(needsAttention(item)){item.reason='미응답 확인 요청 이후 어르신이 답하셨습니다. 확인 후 마무리해 주세요.';staffNotice(db,item,'reply',now);}
  return item;
}
export function resolveCheckin(db, input, now=Date.now()) {
  const item=db.checkins.find(c=>c.id===input.id);
  if(!item||!needsAttention(item))throw Error('확인할 안부 요청이 없습니다.');
  if(typeof input.note!=='string'||!input.note.trim()||input.note.length>1000)throw Error('연락 결과와 조치 내용을 입력해 주세요.');
  if(item.simulation)now=Math.max(now,...item.events.map(e=>e.at+1));
  item.resolvedAt=now;item.resolution=input.note.trim();item.status='resolved';cancelReminders(db,item);log(item,`사회복지사 확인 완료: ${item.resolution}`,now);return item;
}
export function classifyWellnessReply(text) {
  // Only explicit positive responses close automatically. Everything else is human-reviewed.
  const clean=String(text||'').replace(/[\s.,!?。~]/g,'');
  const positives=new Set(['네','예','응','괜찮아요','네괜찮아요','예괜찮아요','잘지내요','네잘지내요','잘지내고있어요','네잘지내고있어요','잘있어요','네잘있어요','저는괜찮아요','괜찮습니다','잘지냅니다']);
  return positives.has(clean)?'okay':'review';
}
export function simulateCheckin(db, input, now=Date.now()) {
  ensureWellness(db);
  let item;
  if(input.id){item=db.checkins.find(c=>c.id===input.id&&c.simulation);if(!item||item.status!=='waiting')throw Error('진행 중인 체험을 선택해 주세요.');now=item.nextAt;}
  else{if(!db.elders.some(e=>e.id===input.elderId))throw Error('어르신을 선택해 주세요.');item=createCheckin(db,input.elderId,now,true);}
  if(item.attempts.length>=item.policy.maxAttempts)flag(db,item,'escalated','체험: 마지막 알림 후 5분 동안 응답이 없어 사회복지사 확인이 필요합니다.',now);
  else{const number=item.attempts.length+1;item.attempts.push({number,at:now,transport:'simulation',result:'simulated'});item.nextAt=now+FIVE_MINUTES;log(item,`체험 ${number}회차 안부 알림 · 실제 발송 없음`,now);}
  return item;
}
export function wellnessCommand(db, path, body, now=Date.now()) {
  ensureWellness(db);
  switch(path){case 'wellness/activity':return markElderActivity(db,body.elderId,now);case 'wellness/reply':return replyCheckin(db,body,now);case 'wellness/resolve':return resolveCheckin(db,body,now);case 'wellness/settings':return updateWellnessSettings(db,body,now);case 'wellness/demo':return simulateCheckin(db,body,now);default:throw Error('지원하지 않는 안부 요청입니다.');}
}
export function publicWellnessState(db) {
  ensureWellness(db);
  return {...db,wellnessDevices:db.wellnessDevices.map(({token,...device})=>device),wellnessOutbox:db.wellnessOutbox.map(({id,kind,checkinId,status,finishedAt,error})=>({id,kind,checkinId,status,finishedAt,error}))};
}
