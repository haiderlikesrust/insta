export type PendingTransaction={intentId:string;signature:string};
export type ConfirmationResult={ok:boolean;status?:string;kind?:string;mint?:string;message?:string};
export class ConfirmationError extends Error{constructor(message:string,public retryable=false){super(message);}}
export function confirmationDestination(result:ConfirmationResult){
 if(result.ok&&['launch','main_launch'].includes(result.kind||'')&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.mint||''))return `/token/${result.mint}`;
}
export function confirmationDelay(ms:number,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  if(signal.aborted)return reject(new DOMException('Aborted','AbortError'));
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  signal.addEventListener('abort',abort,{once:true});
 });
}
export async function requestConfirmation(pending:PendingTransaction,signal:AbortSignal):Promise<ConfirmationResult>{
 const controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
 const timer=setTimeout(abort,20000);
 try{
  const r=await fetch('/api/launch/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending),signal:controller.signal});
  const d=await r.json().catch(()=>({error:'Confirmation service is temporarily unavailable.'})) as ConfirmationResult&{error?:string};
  if(!r.ok)throw new ConfirmationError(d.error||'Unable to confirm this transaction.',r.status===429||r.status>=500);
  if(typeof d.ok!=='boolean')throw new ConfirmationError('Invalid confirmation response.',true);
  return d;
 }catch(e){if(e instanceof ConfirmationError)throw e;throw new ConfirmationError('Connection interrupted. Retrying confirmation automatically…',true);}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export async function pollConfirmation(pending:PendingTransaction,signal:AbortSignal,onStatus:(message:string)=>void,request=requestConfirmation,wait=confirmationDelay){
 let failures=0;
 while(!signal.aborted){
  let delay=4000;
  try{
   const result=await request(pending,signal);if(signal.aborted)return;
   if(result.ok||result.status==='failed'||result.status==='expired')return result;
   failures=0;onStatus(result.message||'Confirming on Solana automatically…');
  }catch(e){
   if(signal.aborted)return;
   if(!(e instanceof ConfirmationError)||!e.retryable)throw e;
   failures++;delay=Math.min(30000,4000*2**Math.min(failures,3));onStatus('Connection delayed. Retrying confirmation automatically…');
  }
  await wait(delay,signal);
 }
}
