import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableAccount,ComputeBudgetProgram,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {hash} from '../lib/domain';
import {assertApprovedTransaction} from '../lib/transactions';
import {LIGHTHOUSE,onlyAppendedWalletAssertions} from '../lib/wallet-assertions';
import {rebroadcast} from '../lib/rebroadcast';

function fixture(lookup=false){
 const payer=Keypair.generate(),recipient=Keypair.generate().publicKey,blockhash=Keypair.generate().publicKey.toBase58();
 const base=[ComputeBudgetProgram.setComputeUnitLimit({units:700000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}),SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:10})];
 const guard=(opcode=6,account=payer.publicKey)=>new TransactionInstruction({programId:new PublicKey(LIGHTHOUSE),keys:[{pubkey:account,isSigner:false,isWritable:false}],data:Buffer.from(opcode===6?'06040300c49f2929020000000403000001000000000000000000':'0a04030300000600000000000000000508','hex')});
 const table=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{deactivationSlot:BigInt('18446744073709551615'),lastExtendedSlot:0,lastExtendedSlotStartIndex:0,addresses:[recipient]}});
 const build=(instructions=base,bh=blockhash)=>new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:bh,instructions}).compileToV0Message(lookup?[table]:[]));
 const prepared=build(),signed=build([...base,guard(),guard(10,recipient)]);signed.sign([payer]);
 return {payer,recipient,base,guard,build,prepared,signed};
}
test('main claim can accept appended Lighthouse assertions with exact original instructions and a valid signature',async()=>{
 for(const lookup of [false,true]){
  const f=fixture(lookup),snapshot=Buffer.from(f.prepared.serialize()).toString('base64'),originalHash=await hash(f.prepared.message.serialize());
  assert.equal(onlyAppendedWalletAssertions(f.prepared,f.signed),true);
  assert.equal(await assertApprovedTransaction(f.signed,f.payer.publicKey.toBase58(),originalHash,snapshot),await hash(f.signed.message.serialize()));
  // No snapshot is supplied for other intent types or historical prepared rows.
  await assert.rejects(assertApprovedTransaction(f.signed,f.payer.publicKey.toBase58(),originalHash),/changed beyond/);
  await assert.rejects(assertApprovedTransaction(f.signed,f.payer.publicKey.toBase58(),'wrong',snapshot),/changed beyond/);
  f.signed.signatures[0].fill(0);
  await assert.rejects(assertApprovedTransaction(f.signed,f.payer.publicKey.toBase58(),originalHash,snapshot),/invalid transaction signature/);
 }
});
test('account index reordering is accepted, but changes in privileges or instruction order are rejected',()=>{
 const f=fixture(),s=VersionedTransaction.deserialize(f.signed.serialize()),m=s.message;
 const a=2,b=3;
 [m.staticAccountKeys[a],m.staticAccountKeys[b]]=[m.staticAccountKeys[b],m.staticAccountKeys[a]];
 const swap=(i:number)=>i===a?b:i===b?a:i;
 m.compiledInstructions.forEach(ix=>{ix.programIdIndex=swap(ix.programIdIndex);ix.accountKeyIndexes=ix.accountKeyIndexes.map(swap);});
 assert.equal(onlyAppendedWalletAssertions(f.prepared,s),true);
 m.header.numReadonlyUnsignedAccounts--;
 assert.equal(onlyAppendedWalletAssertions(f.prepared,s),false);
 assert.equal(onlyAppendedWalletAssertions(f.prepared,f.build([f.base[1],f.base[0],f.base[2],f.guard()])),false);
});
test('wallet assertions cannot hide redirected payouts, extra transfers, different fees, blockhashes, programs or memory writes',()=>{
 const f=fixture(),unknown=Keypair.generate().publicKey;
 const cases=[
  f.build([...f.base.slice(0,2),SystemProgram.transfer({fromPubkey:f.payer.publicKey,toPubkey:unknown,lamports:10}),f.guard()]),
  f.build([...f.base,f.base[2],f.guard()]),
  f.build([f.base[0],ComputeBudgetProgram.setComputeUnitPrice({microLamports:20000}),f.base[2],f.guard()]),
  f.build([...f.base,f.guard()],unknown.toBase58()),
  f.build([f.guard(),...f.base]),
  f.build([...f.base,f.guard(6,unknown)]),
  f.build([...f.base,f.guard(),f.guard(),f.guard(),f.guard()]),
 ];
 const memory=f.guard();memory.data[0]=0;cases.push(f.build([...f.base,memory]));
 const other=f.guard();other.programId=unknown;cases.push(f.build([...f.base,other]));
 const extra=f.guard();extra.keys.push({pubkey:f.recipient,isSigner:false,isWritable:false});cases.push(f.build([...f.base,extra]));
 for(const changed of cases)assert.equal(onlyAppendedWalletAssertions(f.prepared,changed),false);
});
test('rebroadcast uses the accepted signed message hash, retains guard instructions, and rejects later tampering',async()=>{
 const f=fixture(),signedHash=await assertApprovedTransaction(f.signed,f.payer.publicKey.toBase58(),await hash(f.prepared.message.serialize()),Buffer.from(f.prepared.serialize()).toString('base64'));
 const intent={id:'guarded',wallet:f.payer.publicKey.toBase58(),signature:bs58.encode(f.signed.signatures[0]),status:'submitted',message_hash:await hash(f.prepared.message.serialize()),submitted_message_hash:signedHash,signed_transaction:Buffer.from(f.signed.serialize()).toString('base64')};
 let sends=0;
 const rpc={sendRawTransaction:async(bytes:Uint8Array)=>{sends++;assert.equal(Buffer.from(bytes).toString('base64'),intent.signed_transaction);return intent.signature;}};
 await rebroadcast(intent,rpc,async()=>true);assert.equal(sends,1);
 await assert.rejects(rebroadcast({...intent,submitted_message_hash:intent.message_hash},rpc,async()=>true),/verification failed/);
 assert.equal(sends,1);
});
