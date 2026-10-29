import {markElderRequest} from './wellness.mjs';
export function normalizePhone(value){
 if(value==null||value==='')return '';
 if(typeof value!=='string'||value.length>30||!/^[+\d ()-]+$/.test(value))throw Error('전화번호를 확인해 주세요.');
 const phone=value.replace(/[ ()-]/g,'');
 if(!/^\+?\d{8,15}$/.test(phone))throw Error('전화번호를 확인해 주세요.');
 return phone;
}
export function assignedCaregiver(db,elderId,now=Date.now()){
 const elder=db.elders.find(e=>e.id===elderId);
 const approved=id=>db.caregivers.find(c=>c.id===id&&db.accounts?.some(a=>a.caregiverId===id&&a.role==='caregiver'&&!a.disabled&&a.approvalStatus==='approved'));
 const owner=approved(elder?.ownerCaregiverId);if(owner)return owner;
 const next=db.requests.filter(r=>r.elderId===elderId&&r.status==='confirmed'&&r.start+r.duration*60000>=now).sort((a,b)=>a.start-b.start);
 for(const r of next){const caregiver=approved(r.caregiverId);if(caregiver)return caregiver;}
 return null;
}
export function careContact(db,elderId,now){const c=assignedCaregiver(db,elderId,now);if(!c)return null;let phone='';try{phone=normalizePhone(c.phone);}catch{}return {id:c.id,name:c.name,phone};}
export function createSos(db,elderId,now=Date.now()){
 if(!db.elders.some(e=>e.id===elderId))throw Error('어르신을 찾을 수 없습니다.');
 const existing=db.requests.find(r=>r.elderId===elderId&&r.urgency==='sos'&&r.status!=='completed');
 if(existing)return existing;
 const r={id:crypto.randomUUID(),elderId,caregiverId:assignedCaregiver(db,elderId,now)?.id||null,urgency:'sos',service:'긴급 요청 SOS',status:'attention',createdAt:now,requestedAt:now,start:null,duration:0,transcript:'어르신이 SOS 버튼을 눌렀습니다.',reason:'즉시 연락하여 상황을 확인해 주세요. 자동 일정 배정은 하지 않습니다.',events:[{at:now,actor:'어르신',message:'SOS 긴급 요청을 접수했습니다.'}]};
 db.requests.unshift(r);markElderRequest(db,elderId,now);
 db.wellnessOutbox.push({id:'sos:'+r.id,kind:'sos',checkinId:r.id,caregiverId:r.caregiverId,status:'pending',createdAt:now,expiresAt:now+3600000,title:'클로버 · 긴급 SOS',body:'긴급 요청이 접수되었습니다. 앱에서 즉시 확인해 주세요.'});
 return r;
}
export function resolveSos(db,id,note,actor,now=Date.now()){
 const r=db.requests.find(r=>r.id===id&&r.urgency==='sos');if(!r)throw Error('긴급 요청을 찾을 수 없습니다.');
 if(typeof note!=='string'||!note.trim()||note.length>1000)throw Error('연락 및 대응 내용을 입력해 주세요.');
 if(r.status==='completed')return r;
 r.status='completed';r.completedAt=now;r.events.push({at:now,actor:actor.name||'담당자',message:'긴급 요청 대응 완료: '+note.trim()});
 for(const job of db.wellnessOutbox)if(job.kind==='sos'&&job.checkinId===id&&job.status==='pending')job.status='cancelled';
 return r;
}
