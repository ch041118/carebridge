export const SERVICES = ['생활 도움', '병원 동행', '식사 도움', '외출 동행'];
export const active = r => ['pending', 'confirmed'].includes(r.status);
const minute = 60000;
const validLocation=p=>p&&p.locationVerified!==false&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
const enabledCaregiver=(db,c)=>!Array.isArray(db.accounts)||db.accounts.some(a=>a.role==='caregiver'&&a.caregiverId===c.id&&!a.disabled&&a.approvalStatus==='approved');
export function seoulDay(t) { return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
export function localTime(day, hour) { return Date.parse(`${day}T00:00:00+09:00`) + hour * 3600000; }
export function distance(a, b) {
  const rad = x => x * Math.PI / 180;
  const dlat = rad(a.lat - b.lat), dlon = rad(a.lng - b.lng);
  return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2));
}
export function available(db, caregiver, elderId, start, duration, excludeId) {
  if(!caregiver||!Number.isFinite(start)||!Number.isFinite(duration)||duration<=0||duration>1440||!Number.isFinite(caregiver.from)||!Number.isFinite(caregiver.to)||caregiver.from<0||caregiver.to>24||caregiver.from>=caregiver.to||!Array.isArray(caregiver.days))return false;
  const end = start + duration * minute;
  const day = seoulDay(start);
  if (start < localTime(day, caregiver.from) || end > localTime(day, caregiver.to)) return false;
  const weekday = new Date(`${day}T12:00:00+09:00`).getUTCDay();
  if (!caregiver.days.includes(weekday)) return false;
  return !db.requests.some(r => r.id !== excludeId && active(r) && (r.caregiverId === caregiver.id || r.elderId === elderId) && start < r.start + r.duration * minute + 30 * minute && end + 30 * minute > r.start);
}
export function match(db, request, now = Date.now()) {
  if(request.needsReview||request.timeNeedsReview||!Number.isFinite(now)||!Number.isFinite(request.duration)||request.duration<=0||request.duration>1440||(request.requestedAt!=null&&!Number.isFinite(request.requestedAt)))return null;
  const elder = db.elders.find(e => e.id === request.elderId);
  if(!validLocation(elder))return null;
  const earliest = Math.max(now + 30 * minute, request.requestedAt ?? now);
  const start = Math.ceil(earliest / (15 * minute)) * 15 * minute;
  const candidates = db.caregivers.filter(c => enabledCaregiver(db,c) && validLocation(c) && c.services?.includes(request.service) && distance(c, elder) <= 5).sort((a, b) => distance(a, elder) - distance(b, elder));
  for (let time = start; time < start + 7 * 86400000; time += 15 * minute) {
    const caregiver = candidates.find(c => available(db, c, request.elderId, time, request.duration, request.id));
    if (caregiver) return { caregiverId: caregiver.id, start: time, distance: +distance(caregiver, elder).toFixed(1) };
  }
  return null;
}
export function event(request, actor, message) {
  request.events.push({ at: Date.now(), actor, message });
}
export function resolveCandidates(db,request,{start,service}={},now=Date.now()){
 if(!request||request.status!=='attention'||request.urgency==='sos')throw Error('조율할 요청을 확인해 주세요.');
 const time=typeof start==='number'?start:Date.parse(start);
 const selectedService=request.voiceReview&&!request.voiceReview.resolvedAt?service:request.service;
 if(!Number.isFinite(time)||time<now)throw Error('현재 이후의 조율 일시를 선택해 주세요.');
 if(!SERVICES.includes(selectedService))throw Error('돌봄 종류를 먼저 선택해 주세요.');
 return db.caregivers.filter(c=>enabledCaregiver(db,c)&&c.services?.includes(selectedService)&&available(db,c,request.elderId,time,request.duration,request.id)).sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(c=>({id:c.id,name:c.name,address:c.address||'',from:c.from,to:c.to,services:c.services}));
}
export function transition(db, request, action, body = {}, now = Date.now()) {
  if(request.urgency==='sos')throw Error('긴급 요청은 연락 및 대응 내용을 기록하여 처리해 주세요.');
  if (action === 'accept' && request.status === 'pending') {
    request.status = 'confirmed'; event(request, '요양보호사', '일정을 수락했습니다.');
  } else if (action === 'reject' && ['pending', 'confirmed'].includes(request.status)) {
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) throw Error('불가 사유를 입력해 주세요.');
    request.status = 'attention'; request.reason = body.reason.trim(); event(request, '요양보호사', `일정 수행 불가: ${request.reason}`);
  } else if (action === 'complete' && request.status === 'confirmed') {
    if (now < request.start + request.duration * minute) throw Error('예정 종료 시간 이후에 완료할 수 있습니다.');
    request.status = 'completed'; request.completedAt=now; event(request, '요양보호사', '돌봄을 완료했습니다.');
  } else if (action === 'resolve' && request.status === 'attention') {
    const caregiver = db.caregivers.find(c => c.id === body.caregiverId);
    const start = Date.parse(body.start);
    const voiceReview=request.voiceReview&&!request.voiceReview.resolvedAt;
    const service=voiceReview?body.service:request.service;
    if(voiceReview&&(!SERVICES.includes(service)||typeof body.transcript!=='string'||!body.transcript.trim()||body.transcript.length>4000))throw Error('녹음을 듣고 해석한 내용과 돌봄 종류를 입력해 주세요.');
    if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 1000) throw Error('조율 내용을 입력해 주세요.');
    if (!resolveCandidates(db,request,{start,service},now).some(c=>c.id===caregiver?.id)) throw Error('해당 보호사의 계정 상태·가능 시간과 다른 일정을 확인해 주세요.');
    if(voiceReview){request.service=service;request.transcript=body.transcript.trim();request.requestedAt=start;request.timeNeedsReview=false;request.requestedTimeText='사회복지사가 확인한 시간';request.voiceReview.resolvedAt=now;request.voiceReview.interpretation=body.transcript.trim();event(request,'사회복지사',`녹음 해석: ${request.transcript} · ${service}`);}
    request.caregiverId = caregiver.id; request.start = start; request.status = 'pending';
    event(request, '사회복지사', `${caregiver.name} 보호사에게 ${new Date(start).toLocaleString("ko-KR", {timeZone:"Asia/Seoul"})} 재신청: ${body.note.trim()}`);
  } else throw Error('현재 상태에서는 처리할 수 없습니다.');
  return request;
}
