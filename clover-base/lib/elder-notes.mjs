export function canEditElderNotes(db,user,id){return ['admin','social'].includes(user?.role)&&(user.role==='admin'||user.approvalStatus==='approved')||user?.role==='caregiver'&&user.approvalStatus==='approved'&&(db.elders.some(e=>e.id===id&&e.ownerCaregiverId===user.caregiverId)||db.requests.some(r=>r.elderId===id&&r.caregiverId===user.caregiverId&&['pending','confirmed'].includes(r.status)));}
export function saveElderNotes(db,body,user,now=Date.now()){
 if(!canEditElderNotes(db,user,body.id))throw Object.assign(Error('주의 사항을 수정할 권한이 없습니다.'),{status:403});
 const elder=db.elders.find(e=>e.id===body.id);if(!elder)throw Object.assign(Error('어르신을 찾을 수 없습니다.'),{status:404});
 for(const key of ['specialNotes','precautions'])if(typeof body[key]!=='string'||body[key].length>3000)throw Error('특이·주의 사항은 각각 3,000자 이내로 입력해 주세요.');
 if(!Number.isInteger(body.revision)||body.revision!==(elder.notesRevision||0))throw Object.assign(Error('다른 담당자가 내용을 수정했습니다. 상세정보를 다시 열어 최신 내용을 확인해 주세요.'),{status:409});
 elder.specialNotes=body.specialNotes.trim();elder.precautions=body.precautions.trim();elder.notesRevision=(elder.notesRevision||0)+1;elder.notesUpdatedAt=now;elder.notesUpdatedBy=user.name||'담당자';
 elder.notesHistory||=[];elder.notesHistory.push({revision:elder.notesRevision,at:now,actorId:user.id,actorName:elder.notesUpdatedBy,specialNotes:elder.specialNotes,precautions:elder.precautions});
 return {saved:true,revision:elder.notesRevision};
}
