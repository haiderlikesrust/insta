import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConfirmationError,pollConfirmation,confirmationDestination,confirmationDelay,type ConfirmationResult} from '../lib/confirmation-poll';
import {finalizedTransaction} from '../lib/finalized-transaction';
import {paidFees,feeUsd} from '../lib/fee-balances';
const pending={intentId:'pending',signature:'signature'},mint='J9VcA78znYoytynX8N2cSvzi8GSvX9z55as7kUKJZMwC';
test('confirmation retries pending responses and transient failures, then redirects only confirmed launches',async()=>{
 const statuses:string[]=[],delays:number[]=[];let calls=0;
 const result=await pollConfirmation(pending,new AbortController().signal,m=>statuses.push(m),async()=>{calls++;if(calls===1)throw new ConfirmationError('RPC unavailable',true);return calls===2?{ok:false}:{ok:true,kind:'launch',mint};},async ms=>{delays.push(ms);});
 assert.equal(calls,3);assert.deepEqual(delays,[8000,4000]);assert.equal(confirmationDestination(result!),`/token/${mint}`);assert.equal(statuses.length,2);
 for(const kind of ['main_config','main_lookup','claim','main_claim'])assert.equal(confirmationDestination({ok:true,kind,mint}),undefined);
 assert.equal(confirmationDestination({ok:true,kind:'main_launch',mint}),`/token/${mint}`);
 assert.equal(confirmationDestination({ok:false,kind:'launch',mint}),undefined);
 assert.equal(confirmationDestination({ok:true,kind:'launch',mint:'https://evil.example'}),undefined);
});
test('terminal errors stop polling and unmount cancellation discards in-flight results',async()=>{
 let calls=0;await assert.rejects(pollConfirmation(pending,new AbortController().signal,()=>{},async()=>{calls++;throw new ConfirmationError('Transaction failed');}),/failed/);assert.equal(calls,1);
 const abort=new AbortController();let finish!:(r:ConfirmationResult)=>void;
 const run=pollConfirmation(pending,abort.signal,()=>{},()=>new Promise(resolve=>{finish=resolve;}));abort.abort();finish({ok:true,kind:'launch',mint});assert.equal(await run,undefined);
 await assert.rejects(confirmationDelay(1000,abort.signal),/Aborted/);
});
test('finality checks tolerate indexing lag but reject failed or expired transactions',async()=>{
 const conn={getTransaction:async()=>null,getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>10} as any;
 assert.equal(await finalizedTransaction(conn,'sig',20),null);
 await assert.rejects(finalizedTransaction(conn,'sig',9),/expired/);
 conn.getSignatureStatuses=async()=>({value:[{confirmationStatus:'finalized',err:null}]});assert.equal(await finalizedTransaction(conn,'sig',9),null);
 conn.getTransaction=async()=>({meta:{err:{InstructionError:[0,'fail']}}});await assert.rejects(finalizedTransaction(conn,'sig',20),/failed/);
 const landed={meta:{err:null}};conn.getTransaction=async()=>landed;assert.equal(await finalizedTransaction(conn,'sig',20),landed);
});
test('fee payouts count completed settlements only and keep the buyback separate',()=>{
 const complete={gross:'1000000000',creator_amount:'900000000',buyback_amount:'100000000',completed_at:1};
 const fees=paidFees([complete,{...complete,completed_at:null}]);assert.deepEqual(fees,{gross:'1000000000',paid:'900000000',buyback:'100000000',count:1});
 assert.equal(feeUsd(fees.paid,100),90);assert.equal(feeUsd('0',100),0);assert.equal(feeUsd(null,100),null);assert.equal(feeUsd('1000000000',null),null);
});
