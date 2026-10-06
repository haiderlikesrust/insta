import {createHmac} from 'node:crypto';
const base=process.env.SETTLEMENT_ORIGIN||'http://web:3000';
// Only resumes claims that a freshly verified creator already authorized.
async function tick(){
 const secret=process.env.BACKEND_WALLET_SECRET_KEY;if(!secret)return;
 const minute=Math.floor(Date.now()/60000),proof=`${minute}:${createHmac('sha256',secret).update(`instara:settle:v1:${minute}`).digest('hex')}`;
 try{
  const response=await fetch(base+'/api/internal/settle',{method:'POST',headers:{'x-instara-worker':proof},signal:AbortSignal.timeout(120000)});
  if(!response.ok)console.error('Settlement service unavailable:',response.status);
 }catch{console.error('Settlement service connection interrupted; will retry.');}
}
for(;;){await tick();await new Promise(resolve=>setTimeout(resolve,15000));}
