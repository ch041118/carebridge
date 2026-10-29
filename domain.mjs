import {randomUUID} from 'node:crypto';
export const example='At lunch today, the resident ate less than usual and said they felt dizzy while walking.';
export const fields=['observedAt','facts','statements','actions','questions'];
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function validateInput(b){
 if(typeof b.source!=='string'||!b.source.trim()||b.source.length>4000)throw fail('메모를 1~4000자로 입력해 주세요.');
 if(!['en','vi','zh','ko'].includes(b.language))throw fail('지원하는 입력 언어를 선택해 주세요.');
 if(b.privacy!==true)throw fail('개인 식별정보를 제거했는지 확인해 주세요.');
 if(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\d[\s-]?){9,}/.test(b.source))throw fail('연락처·식별번호로 보이는 내용을 제거해 주세요.');
 return {source:b.source.trim(),language:b.language};
}
export function validateDraft(d,source){
 if(!d||typeof d.translation!=='string'||!d.translation.trim()||d.translation.length>8000)throw fail('AI 번역 응답 형식이 올바르지 않습니다.',502);
 const out={translation:d.translation};
 for(const f of fields){
  if(!Array.isArray(d[f])||d[f].length>20)throw fail('AI 항목 형식이 올바르지 않습니다.',502);
  out[f]=d[f].map(x=>{
   if(!x||typeof x.text!=='string'||!x.text.trim()||x.text.length>1000||typeof x.evidence!=='string'||x.evidence.length>4000||(!x.evidence&&f!=='questions')||(x.evidence&&!source.includes(x.evidence)))throw fail('원문 근거가 없는 AI 항목입니다. 다시 생성하거나 직접 확인해 주세요.',502);
   return {text:x.text,evidence:x.evidence};
  });
 }
 return out;
}
export const fixture=()=>({translation:'오늘 점심에 대상자는 평소보다 적게 드셨고, 걸을 때 어지럽다고 말씀하셨다.',observedAt:[{text:'오늘 점심',evidence:'At lunch today'}],facts:[{text:'평소보다 적게 식사함',evidence:'ate less than usual'}],statements:[{text:'보행 중 어지러움을 호소함',evidence:'said they felt dizzy while walking'}],actions:[],questions:[{text:'정확한 관찰 날짜·섭취량·수행 조치 확인 필요',evidence:''}]});
export function createNote(input,draft,user,mode){const at=new Date().toISOString();return {id:randomUUID(),...input,author:user.id,status:'pending',version:1,mode,draft,review:null,createdAt:at,history:[{at,actor:user.name,event:'메모 접수',version:1}]};}
export function transition(note,b,user){
 if(b.version!==note.version)throw fail('다른 변경이 있습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.',409);
 if(note.status==='confirmed')throw fail('확정 기록은 변경할 수 없습니다.',409);
 if(b.action==='resubmit'){
  if(user.role!=='admin'&&(user.role!=='writer'||user.id!==note.author))throw fail('작성자만 보완할 수 있습니다.',403);
  if(note.status!=='revision')throw fail('수정 요청된 기록만 보완할 수 있습니다.',409);
  if(typeof b.supplement!=='string'||!b.supplement.trim()||b.supplement.length>2000)throw fail('보완 내용을 입력해 주세요.');
  validateInput({source:b.supplement,language:note.language,privacy:b.privacy});
  note.supplements||=[];note.supplements.push(b.supplement.trim());note.status='pending';
 }else{
  if(!['reviewer','admin'].includes(user.role))throw fail('담당자만 검토할 수 있습니다.',403);
  if(!['review','revision','confirm'].includes(b.action))throw fail('알 수 없는 작업입니다.');
  if(b.action==='review'){if(note.status!=='pending')throw fail('검토 대기 기록만 시작할 수 있습니다.',409);note.status='reviewing';}
  else{
   if(note.status!=='reviewing')throw fail('검토를 시작한 뒤 처리해 주세요.',409);
   if(typeof b.comment!=='string'||!b.comment.trim()||b.comment.length>2000)throw fail('검토 의견을 입력해 주세요.');
   if(b.action==='confirm'){
    if(b.checked!==true)throw fail('원문과 근거를 확인해 주세요.');
    if(typeof b.record!=='string'||!b.record.trim()||b.record.length>10000)throw fail('확정할 기록을 입력해 주세요.');
    note.review={record:b.record.trim(),comment:b.comment.trim(),reviewer:user.name};note.status='confirmed';
   }else{note.feedback=b.comment.trim();note.status='revision';}
  }
 }
 note.version++;note.history.push({at:new Date().toISOString(),actor:user.name,event:({review:'검토 시작',revision:'수정 요청',confirm:'기록 확정',resubmit:'작성자 보완 제출'})[b.action],version:note.version,comment:b.comment?.trim()||b.supplement?.trim()||''});return note;
}
