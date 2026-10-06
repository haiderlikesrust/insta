import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemInstruction,VersionedTransaction} from '@solana/web3.js';
import {decodeBurnInstruction,decodeTransferInstruction} from '@solana/spl-token';
import bs58 from 'bs58';
import {backendWallet,feeWallet,payoutTransaction,purchasedAmount,workerAuthorization,validWorkerAuthorization} from '../lib/custody';
import {settleClaimWith,type Claim,type SettlementDependencies} from '../lib/settlement-engine';
import {hash} from '../lib/domain';
import {validSignatures} from '../lib/transactions';

test('backend secret parsing and mint-separated deterministic custody',()=>{
 const master=Keypair.generate(),mint=Keypair.generate().publicKey;
 assert.equal(backendWallet(JSON.stringify(Array.from(master.secretKey))).publicKey.toBase58(),master.publicKey.toBase58());
 assert.equal(backendWallet(bs58.encode(master.secretKey)).publicKey.toBase58(),master.publicKey.toBase58());
 assert.throws(()=>backendWallet(master.publicKey.toBase58()));assert.throws(()=>backendWallet(undefined));
 assert.equal(feeWallet(master,mint).publicKey.toBase58(),feeWallet(master,mint).publicKey.toBase58());
 assert.notEqual(feeWallet(master,mint).publicKey.toBase58(),feeWallet(master,Keypair.generate().publicKey).publicKey.toBase58());
 assert.notEqual(feeWallet(master,mint).publicKey.toBase58(),feeWallet(Keypair.generate(),mint).publicKey.toBase58());
});
test('burn and native-SOL payout are in the same transaction, rent excluded from recipient amount',()=>{
 const [payer,authority,recipient,mint,temp]=Array.from({length:5},()=>Keypair.generate().publicKey);
 const tx=payoutTransaction(payer,authority,recipient,mint,BigInt(90009),BigInt(123456),2039280,temp);
 assert.equal(decodeBurnInstruction(tx.instructions[0]).data.amount,BigInt(123456));
 assert.equal(decodeTransferInstruction(tx.instructions[3]).data.amount,BigInt(90009));
 const payout=SystemInstruction.decodeTransfer(tx.instructions[5]);assert.equal(payout.lamports,BigInt(90009));assert.ok(payout.toPubkey.equals(recipient));
 assert.equal(tx.instructions[4].keys[1].pubkey.toBase58(),payer.toBase58());
 assert.throws(()=>payoutTransaction(payer,authority,recipient,mint,BigInt(0),BigInt(1),2039280,temp));
});
test('worker authentication rejects tampering, missing keys and expired requests',()=>{
 const now=Date.now(),proof=workerAuthorization('secret',Math.floor(now/60000));
 assert.ok(validWorkerAuthorization('secret',proof,now));assert.equal(validWorkerAuthorization('other',proof,now),false);
 assert.equal(validWorkerAuthorization(undefined,proof,now),false);assert.equal(validWorkerAuthorization('secret',proof,now+180000),false);
});
async function fixture(){
 const master=Keypair.generate(),mint=Keypair.generate().publicKey,target=Keypair.generate().publicKey,authority=feeWallet(master,mint);
 const message=Buffer.from('a finalized, previously approved collection and swap');
 const balance=(amount:string)=>({owner:authority.publicKey.toBase58(),mint:target.toBase58(),uiTokenAmount:{amount}});
 const collected={meta:{err:null,preTokenBalances:[balance('7')],postTokenBalances:[balance('130')]},transaction:{message:{serialize:()=>message}}};
 const row:Claim={id:'claim',token_id:'coin',wallet:Keypair.generate().publicKey.toBase58(),mint:mint.toBase58(),vault:authority.publicKey.toBase58(),status:'submitted',signature:'collection',message_hash:await hash(message),last_valid_height:100,buyback_mint:target.toBase58(),gross:'10000',creator_amount:'9000',buyback_amount:'1000',minimum_burn:'100',collection_tx:Buffer.from('original signed collection').toString('base64'),payout_tx:null,payout_signature:null,payout_height:null,burn_amount:null,completed_at:null};
 const landed=new Map<string,any>([['collection',collected]]),statuses=new Map<string,any>(),sent:string[]=[];
 let height=50,simulationError:any=null,failSend=false;
 const connection:any={
  getTransaction:async(s:string)=>landed.get(s)||null,getSignatureStatuses:async([s]:string[])=>({value:[statuses.get(s)||null]}),getBlockHeight:async()=>height,
  getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:height+150}),
  getMinimumBalanceForRentExemption:async()=>2039280,
  simulateTransaction:async(tx:VersionedTransaction)=>{assert.ok(validSignatures(tx));return {value:{err:simulationError}};},
  sendRawTransaction:async(bytes:Buffer)=>{sent.push(bytes.toString('base64'));if(failSend)throw new Error('timeout');return 'sent';}
 };
 const deps:SettlementDependencies={connection,master:()=>master,load:async()=>({...row}),fail:async()=>{row.status='failed';},complete:async()=>{row.completed_at=Date.now();row.status='confirmed';},
  clearPayout:async(_,signature)=>{if(row.payout_signature===signature&&!row.completed_at){row.payout_signature=null;row.payout_tx=null;row.payout_height=null;}},
  savePayout:async(_,v)=>{if(!row.payout_signature&&!row.completed_at){row.payout_signature=v.signature;row.payout_tx=v.encoded;row.payout_height=v.height;row.burn_amount=v.burn;}}
 };
 return {row,deps,landed,statuses,sent,collected,master,authority,target,setHeight:(n:number)=>height=n,setError:(e:any)=>simulationError=e,setFailSend:()=>failSend=true};
}
test('concurrent settlement workers persist and broadcast one payout; confirmed replay never pays again',async()=>{
 const f=await fixture();assert.equal(purchasedAmount(f.collected,f.authority.publicKey,f.target),BigInt(123));
 await Promise.all([settleClaimWith('claim',f.deps),settleClaimWith('claim',f.deps)]);
 assert.ok(f.sent.length>=1);assert.equal(new Set(f.sent).size,1);assert.equal(f.row.burn_amount,'123');
 const signed=VersionedTransaction.deserialize(Buffer.from(f.row.payout_tx!,'base64'));
 f.landed.set(f.row.payout_signature!,{meta:{err:null},transaction:{message:signed.message}});
 assert.equal((await settleClaimWith('claim',f.deps)).ok,true);const count=f.sent.length;
 assert.equal((await settleClaimWith('claim',f.deps)).ok,true);assert.equal(f.sent.length,count);
});
test('RPC timeout resends identical signed payout; only finalized expiry permits replacement',async()=>{
 const f=await fixture();f.setFailSend();await settleClaimWith('claim',f.deps);const first=f.row.payout_tx;
 await settleClaimWith('claim',f.deps);assert.equal(f.row.payout_tx,first);assert.equal(new Set(f.sent).size,1);
 f.setHeight(1000);f.statuses.set(f.row.payout_signature!,{confirmationStatus:'confirmed',err:null});
 await settleClaimWith('claim',f.deps);assert.equal(f.row.payout_tx,first);
 f.statuses.clear();await settleClaimWith('claim',f.deps);assert.notEqual(f.row.payout_tx,first);assert.equal(f.row.burn_amount,'123');assert.equal(f.row.buyback_amount,'1000');
});
test('pending or failed buyback never pays; insufficient backend funds retains the claim',async()=>{
 const f=await fixture();f.landed.clear();await settleClaimWith('claim',f.deps);assert.equal(f.row.payout_tx,null);assert.equal(f.sent[0],f.row.collection_tx);
 f.setHeight(101);await assert.rejects(settleClaimWith('claim',f.deps),/failed/);assert.equal(f.row.status,'failed');
 const g=await fixture();g.setError({InstructionError:[0,'InsufficientFunds']});await assert.rejects(settleClaimWith('claim',g.deps),/funding/);assert.equal(g.row.status,'submitted');assert.equal(g.row.payout_tx,null);assert.equal(g.sent.length,0);
});
test('wrong master key or mismatched confirmed transaction cannot authorize a payout',async()=>{
 const f=await fixture();f.deps.master=()=>Keypair.generate();await assert.rejects(settleClaimWith('claim',f.deps),/original backend key/);assert.equal(f.sent.length,0);
 const g=await fixture();g.row.message_hash='wrong';await assert.rejects(settleClaimWith('claim',g.deps),/mismatch/);assert.equal(g.sent.length,0);
});
