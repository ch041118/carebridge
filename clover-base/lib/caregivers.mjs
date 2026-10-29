import {normalizePhone} from './sos.mjs';
import { SERVICES } from './scheduler.mjs';
export const DEMO_REGIONS = [
  {id:'yeonnam',address:'서울 마포구 연남동 (체험 지역)',lat:37.5668,lng:126.919},
  {id:'seogyo',address:'서울 마포구 서교동 (체험 지역)',lat:37.554,lng:126.921},
  {id:'gangnam',address:'서울 강남구 역삼동 (체험 지역)',lat:37.5,lng:127.036}
];
export function validateHours(body) {
  const {from,to,days}=body;
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to>24||from>=to||!Number.isInteger(from*4)||!Number.isInteger(to*4)||!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('근무 요일을 하나 이상 선택하고 시작·종료 시간을 15분 단위로 입력해 주세요. 야간 근무는 아직 지원하지 않습니다.');
  return {from,to,days:[...new Set(days)].sort()};
}
export async function saveCaregiver(db, body, {demo=false,geocode}={}) {
  const old=body.id?db.caregivers.find(c=>c.id===body.id):null;
  if(body.id&&!old)throw Error('요양보호사를 찾을 수 없습니다.');
  const hours=validateHours(body);const phone=normalizePhone(body.phone===undefined?old?.phone:body.phone);
  const name=old?.name??body.name;
  if(typeof name!=='string'||!name.trim()||name.length>50)throw Error('성함을 입력해 주세요.');
  const services=old?.services??body.services;
  if(!Array.isArray(services)||!services.length||services.some(s=>!SERVICES.includes(s)))throw Error('제공할 돌봄 서비스를 하나 이상 선택해 주세요.');
  let location;
  if(demo){
    const region=DEMO_REGIONS.find(r=>r.id===body.regionId);
    if(!region)throw Error('체험할 근무 지역을 선택해 주세요.');
    location={address:region.address,lat:region.lat,lng:region.lng,regionId:region.id};
  }else{
    const address=body.address?.trim();
    if(!address||address.length>200)throw Error('근무 희망 지역의 기준 주소를 입력해 주세요.');
    const coords=old?.address===address&&old.locationVerified!==false?{lat:old.lat,lng:old.lng}:await geocode(address);
    if(coords.locationVerified!==false&&(!Number.isFinite(coords.lat)||!Number.isFinite(coords.lng)||Math.abs(coords.lat)>90||Math.abs(coords.lng)>180))throw Error('지역의 위치를 확인하지 못했습니다.');
    location={address,locationVerified:coords.locationVerified!==false,...coords};
  }
  // Validate/geocode first. Failed edits must leave both profile and bookings untouched.
  const profile={phone,...location,...hours,updatedAt:Date.now()};
  if(old){Object.assign(old,profile);return old;}
  const caregiver={id:crypto.randomUUID(),name:name.trim(),initials:name.trim().slice(-2),services:[...new Set(services)],...profile,createdAt:Date.now()};
  db.caregivers.push(caregiver);return caregiver;
}
