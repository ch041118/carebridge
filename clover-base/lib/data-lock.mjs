import { existsSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const held=new Set();
export function lockDataDirectory(directory){
  const file=resolve(directory,'.clover-writer.lock');
  if(existsSync(file)){
    let previous;try{previous=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('데이터 저장소 잠금 파일을 확인해 주세요.');}
    let alive=true;try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(previous.pid===process.pid&&!held.has(file))alive=false;
    if(alive)throw Error('같은 데이터 저장소를 사용하는 서버 또는 계정 관리 명령이 실행 중입니다. 먼저 종료해 주세요.');
    unlinkSync(file);
  }
  writeFileSync(file,JSON.stringify({pid:process.pid,createdAt:Date.now()}),{flag:'wx',mode:0o600});
  held.add(file);
  const release=()=>{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);held.delete(file);}catch{}};
  process.once('exit',release);return release;
}
