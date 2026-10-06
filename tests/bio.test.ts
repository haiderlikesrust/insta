import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBioProof, bioCode, parseProfile } from '../lib/bio-proof';
import { startProfileRead, readProfileResult } from '../lib/profile-reader';
const now=Date.now(),code='INSTARA-0123456789abcdef0123456789abcdef';
const raw={id:'12345',username:'the_creator',biography:`Art and coffee\n${code}`,private:false,followersCount:1234};
const c={account_id:'instagram-public:12345',username:'the_creator',code,expires_at:now+10000,phase:'checking',wallet:'wallet-A',session_hash:'session-A'};
test('bio proof requires exact account, wallet, session, fresh nonce and unused challenge',()=>{
 const p=parseProfile([raw],'the_creator');assert.doesNotThrow(()=>assertBioProof(c,p,c.wallet,c.session_hash,now));
 for(const bad of [{...c,wallet:'wallet-B'},{...c,session_hash:'session-B'},{...c,expires_at:now},{...c,phase:'verified'},{...c,code:bioCode()},{...c,account_id:'instagram-public:999'}])assert.throws(()=>assertBioProof(bad,p,c.wallet,c.session_hash,now));
 assert.throws(()=>assertBioProof(c,{...p,biography:code+'a'},c.wallet,c.session_hash,now));
 assert.throws(()=>assertBioProof(c,{...p,username:'another'},c.wallet,c.session_hash,now));
});
test('profile reader rejects ambiguous, private, missing and changed profiles',()=>{
 for(const value of [[],[raw,raw],[{...raw,private:true}],[{...raw,id:12345}],[{...raw,username:'other'}],[{...raw,biography:undefined}],[{error:'not_found'}]])assert.throws(()=>parseProfile(value,'the_creator'));
 assert.equal(parseProfile([raw],'the_creator').followers,1234);
 const a=bioCode(),b=bioCode();assert.match(a,/^INSTARA-[a-f0-9]{32}$/);assert.notEqual(a,b);
});
test('server reader uses a fresh bounded run and retrieves only its result',async()=>{
 const original=globalThis.fetch;const requests:{url:string;init:RequestInit|undefined}[]=[];
 const responses=[{data:{id:'run123'}},{data:{id:'run123',status:'RUNNING'}},{data:{id:'run123',status:'SUCCEEDED',defaultDatasetId:'data123'}},[raw]];
 globalThis.fetch=async(input,init)=>{requests.push({url:String(input),init});return Response.json(responses.shift());};
 try{
  assert.equal(await startProfileRead('the_creator','test-token'),'run123');
  assert.equal(await readProfileResult('run123','test-token'),null);
  assert.deepEqual(await readProfileResult('run123','test-token'),[raw]);
  assert.ok(requests[0].url.includes('maxTotalChargeUsd=0.01'));
  assert.equal(requests[0].init?.method,'POST');assert.equal((requests[0].init?.headers as Record<string,string>).Authorization,'Bearer test-token');
  assert.ok(requests.every(r=>!r.url.includes('test-token')));assert.match(requests[3].url,/datasets\/data123\/items/);
  await assert.rejects(()=>readProfileResult('../other','test-token'));
 }finally{globalThis.fetch=original;}
});
