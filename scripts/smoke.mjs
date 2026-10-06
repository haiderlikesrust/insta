import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
const base=process.argv[2]||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Smoke writes are local-only.');
let cookie='';
async function call(path,body,origin=base,retried=false){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:text.slice(0,300)};}if(!retried && r.status===503 && data.error?.startsWith('Your worker restarted mid-request')){await new Promise(r=>setTimeout(r,300));return call(path,body,origin,true);}return{status:r.status,data,cookie:r.headers.get('set-cookie')};}
const state=await call('state');assert.equal(state.status,200);assert.equal(state.data.status.live,false);
assert.equal((await call('admin/state')).status,401);
assert.equal((await call('admin/prepare',{})).status,401);
assert.equal((await call('internal/settle',{})).status,401);
assert.equal((await call('admin/config/prepare',{})).status,401);
const k=Keypair.generate();assert.equal((await call('wallet/challenge',{wallet:k.publicKey.toBase58()},'https://attacker.example')).status,403);
// The helper retries only Wrangler's explicit local proxy restart response.
const challenge=await call('wallet/challenge',{wallet:k.publicKey.toBase58()});
assert.equal(challenge.status,200,JSON.stringify(challenge.data));
const signature=Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.data.message),k.secretKey));
const auth=await call('wallet/verify',{id:challenge.data.id,signature});assert.equal(auth.status,200);assert.match(auth.cookie,/HttpOnly/);cookie=auth.cookie.split(';')[0];
assert.equal((await call('wallet/verify',{id:challenge.data.id,signature})).status,401);
for(const [path,input] of [['admin/state',undefined],['admin/prepare',{}],['admin/claim',{}],['admin/config/prepare',{}],['admin/config/recover',{}]])assert.ok([403,503].includes((await call(path,input)).status),'Non-dev wallet must not access '+path);
const draft=await call('drafts',{name:'Local QA draft',symbol:'LOCALQA',handle:'instara_qa_missing',description:'Local-only security test',image:'',metadataUri:''});assert.equal(draft.status,200);
const loaded=await call('state');assert.ok(loaded.data.drafts.some(d=>d.id===draft.data.id));
assert.equal((await call('bio/status',{})).data.challenge,null);
assert.equal((await call('bio/start',{username:'instara_qa_missing'})).status,503);
assert.equal((await call('recipient/start',{username:'instara_qa_missing'})).status,503);
const launch=await call('launch/prepare',{id:draft.data.id});assert.equal(launch.status,503);assert.match(launch.data.error,/disabled|enabled/);
const price=await call('price');assert.equal(price.status,200);if(price.data.price){assert.ok(price.data.price.targets.start>0);assert.ok(Math.abs(price.data.price.targets.graduation/price.data.price.targets.start-12.5)<1e-10);}
assert.equal((await call('wallet/logout',{})).status,200);assert.equal((await call('drafts',{id:draft.data.id})).status,401);
if(process.env.RUN_ADMIN_SMOKE==='true'){
 const dev=Keypair.fromSeed(new Uint8Array(32).fill(17));
 const c=await call('wallet/challenge',{wallet:dev.publicKey.toBase58()});assert.equal(c.status,200);
 const signed=Array.from(nacl.sign.detached(new TextEncoder().encode(c.data.message),dev.secretKey));
 const login=await call('wallet/verify',{id:c.data.id,signature:signed});assert.equal(login.status,200);cookie=login.cookie.split(';')[0];
 const admin=await call('admin/state');assert.equal(admin.status,200);assert.equal(admin.data.wallet,dev.publicKey.toBase58());assert.equal(admin.data.enabled,false);
 const blocked=await call('admin/prepare',{description:'Disposable test',image:'https://example.com/image.png',metadataUri:'https://example.com/metadata.json'});assert.equal(blocked.status,503);assert.match(blocked.data.error,/not enabled/);
 assert.equal((await call('admin/claim',{})).status,409);
 assert.equal((await call('admin/config/prepare',{})).status,503);
 await call('wallet/logout',{});assert.equal((await call('admin/state')).status,401);
 console.log('PASS: admin HTTP lock rejects other wallets and accepts only the signed allowlisted wallet; mainnet launch stays disabled.');
}
console.log('PASS: local HTTP persistence, CSRF, signed wallet authentication, replay rejection, live gate, price API, logout.');

// Exercise HTML rendering after server-only crypto modules have been loaded.
for(const path of ['/','/admin']){const response=await fetch(base+path);assert.equal(response.status,200);const html=await response.text();assert.ok(html.length>1000,'HTML must not be empty');assert.match(html,/Instara/);if(path==='/')assert.match(html,/https:\/\/x.com\/instaraxyz/);}
console.log('PASS: pages still render after backend modules load.');
