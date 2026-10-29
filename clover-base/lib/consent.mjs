export const CONSENT_VERSION='2026-10-02';
export function registrationConsent(body,{proxyRequired=false,now=Date.now()}={}){
  const input=body.consent;
  if(input?.version!==CONSENT_VERSION||input.personal!==true)throw Object.assign(Error('개인정보 수집·이용 안내를 읽고 동의해 주세요.'),{status:400});
  if(proxyRequired&&input.authority!==true)throw Object.assign(Error('어르신 본인의 동의 또는 적법한 대리 권한을 확인해 주세요.'),{status:400});
  return {version:CONSENT_VERSION,personal:true,authority:input.authority===true,recordedAt:now};
}
