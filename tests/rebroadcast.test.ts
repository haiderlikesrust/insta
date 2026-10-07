import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ComputeBudgetProgram,Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {hash} from '../lib/domain';
import {rebroadcast} from '../lib/rebroadcast';
import {pollConfirmation,confirmationDestination} from '../lib/confirmation-poll';
import {finalizedTransaction,TransactionOutcomeError} from '../lib/finalized-transaction';
import {assertApprovedTransaction} from '../lib/transactions';
async function signedIntent(){
 const payer=Keypair.generate();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message());tx.sign([payer]);
 return {id:'test',wallet:payer.publicKey.toBase58(),signature:bs58.encode(tx.signatures[0]),message_hash:await hash(tx.message.serialize()),signed_transaction:Buffer.from(tx.serialize()).toString('base64'),status:'submitted'};
}
test('broadcast retries retain exactly the same signed transaction after an RPC timeout',async()=>{
 const intent=await signedIntent(),sent:Buffer[]=[];
 const rpc={sendRawTransaction:async(bytes:Uint8Array)=>{sent.push(Buffer.from(bytes));throw new Error('timeout');}};
 await rebroadcast(intent,rpc,async()=>true);await rebroadcast(intent,rpc,async()=>true);
 assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].toString('base64'),intent.signed_transaction);
});
test('broadcast skips unsigned legacy rows and rejects tampering; the database lease prevents duplicate sends',async()=>{
 const intent=await signedIntent();let sent=0,leased=false;
 const rpc={sendRawTransaction:async()=>{sent++;return intent.signature;}};
 assert.equal(await rebroadcast({...intent,signed_transaction:null},rpc,async()=>true),false);
 await assert.rejects(rebroadcast({...intent,message_hash:'wrong'},rpc,async()=>true),/verification failed/);
 await Promise.all([1,2].map(()=>rebroadcast(intent,rpc,async()=>{if(leased)return false;leased=true;return true;})));
 assert.equal(sent,1);
});
test('expired dev claims stop polling without a success redirect so the wallet can authorize a fresh attempt',async()=>{
 const result=await pollConfirmation({intentId:'id',signature:'sig'},new AbortController().signal,()=>{},async()=>({ok:false,status:'expired',kind:'main_claim',message:'Try a new claim.'}));
 assert.equal(result?.status,'expired');assert.equal(confirmationDestination(result!),undefined);
});
test('terminal outcomes are distinguished from missing metadata and successful but unindexed transactions',async()=>{
 const c={getTransaction:async()=>null,getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>100} as any;
 await assert.rejects(finalizedTransaction(c,'sig',50),e=>e instanceof TransactionOutcomeError&&e.outcome==='expired');
 c.getSignatureStatuses=async()=>({value:[{confirmationStatus:'finalized',err:null}]});assert.equal(await finalizedTransaction(c,'sig',50),null);
 c.getTransaction=async()=>({meta:null});await assert.rejects(finalizedTransaction(c,'sig',50),e=>!(e instanceof TransactionOutcomeError));
 c.getTransaction=async()=>({meta:{err:{InstructionError:[0,1]}}});await assert.rejects(finalizedTransaction(c,'sig',50),e=>e instanceof TransactionOutcomeError&&e.outcome==='failed');
});
test('explicit priority fees survive wallet signing; fee edits and invalid signatures have distinct errors',async()=>{
 const payer=Keypair.generate(),recipient=Keypair.generate().publicKey,blockhash=Keypair.generate().publicKey.toBase58();
 const build=(price:number,to=recipient)=>new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:700000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:price}),SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:to,lamports:1})]}).compileToV0Message());
 const prepared=build(10000),expected=await hash(prepared.message.serialize());
 const signed=VersionedTransaction.deserialize(prepared.serialize());signed.sign([payer]);
 await assertApprovedTransaction(signed,payer.publicKey.toBase58(),expected);
 const editedFee=build(20000);editedFee.sign([payer]);
 await assert.rejects(assertApprovedTransaction(editedFee,payer.publicKey.toBase58(),expected),/changed beyond/);
 const redirected=build(10000,Keypair.generate().publicKey);redirected.sign([payer]);
 await assert.rejects(assertApprovedTransaction(redirected,payer.publicKey.toBase58(),expected),/changed beyond/);
 await assert.rejects(assertApprovedTransaction(prepared,payer.publicKey.toBase58(),expected),/missing or invalid/);
 await assert.rejects(assertApprovedTransaction(signed,recipient.toBase58(),expected),/different wallet/);
});
