import {Keypair,PublicKey,VersionedTransaction,type Connection} from '@solana/web3.js';
import {ACCOUNT_SIZE} from '@solana/spl-token';
import bs58 from 'bs58';
import {AppError,hash} from './domain';
import {feeWallet,purchasedAmount,payoutTransaction} from './custody';
import {versioned} from './transactions';
export type Claim={id:string;token_id:string;wallet:string;mint:string;vault:string;status:string;signature:string;message_hash:string;last_valid_height:number;
 buyback_mint:string;gross:string;creator_amount:string;buyback_amount:string;minimum_burn:string;collection_tx:string;
 payout_tx:string|null;payout_signature:string|null;payout_height:number|null;burn_amount:string|null;completed_at:number|null};

export interface SettlementDependencies{
 connection:Connection;master:()=>Keypair;tables?:string;
 load:(id:string)=>Promise<Claim|null>;fail:(id:string)=>Promise<unknown>;complete:(id:string)=>Promise<unknown>;
 clearPayout:(id:string,signature:string)=>Promise<unknown>;
 savePayout:(id:string,value:{encoded:string;signature:string;height:number;burn:string})=>Promise<unknown>;
}
async function broadcast(connection:Connection,encoded:string){
 try{await connection.sendRawTransaction(Buffer.from(encoded,'base64'),{skipPreflight:false,maxRetries:3});}catch{/* Persisted signatures are reconciled before any replacement is built. */}
}

// null: still pending; failed: definitively failed/expired; tx: finalized success.
async function outcome(connection:Connection,signature:string,height:number){
 const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
 if(tx)return tx.meta&&!tx.meta.err?tx:'failed';
 const state=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
 // Wait for finality even on errors; confirmed forks may still change.
 if(state?.confirmationStatus==='finalized')return state.err?'failed':null;
 if(!state&&await connection.getBlockHeight('finalized')>height)return 'failed';
 return null;
}
export async function settleClaimWith(id:string,deps:SettlementDependencies){
 const {connection}=deps;
 let row=await deps.load(id);if(!row)throw new AppError('Claim not found.',404);
 if(row.completed_at)return {ok:true,kind:'claim',payoutSignature:row.payout_signature,burned:row.burn_amount};
 if(row.status==='failed')throw new AppError('The buyback expired or failed without a payout. Start a new claim.',409);
 const collected=await outcome(connection,row.signature,row.last_valid_height);
 if(collected==='failed'){
  await deps.fail(id);
  throw new AppError('The buyback expired or failed. Fees remain available for a new claim.',409);
 }
 if(!collected){await broadcast(connection,row.collection_tx);return {ok:false,kind:'claim',stage:'buyback'};}
 if(await hash(collected.transaction.message.serialize())!==row.message_hash)throw new AppError('Buyback transaction mismatch.',409);
 const master=deps.master(),authority=feeWallet(master,new PublicKey(row.mint));
 if(authority.publicKey.toBase58()!==row.vault)throw new AppError('Restore the original backend key to complete this payout.',503);
 const acquired=purchasedAmount(collected,authority.publicKey,new PublicKey(row.buyback_mint));
 if(acquired<BigInt(row.minimum_burn))throw new AppError('Confirmed buyback output is below its recorded minimum.',409);
 if(row.payout_signature){
  const paid=await outcome(connection,row.payout_signature,row.payout_height!);
  if(paid&&paid!=='failed'){
   const expected=VersionedTransaction.deserialize(Buffer.from(row.payout_tx!,'base64'));
   if(await hash(paid.transaction.message.serialize())!==await hash(expected.message.serialize()))throw new AppError('Payout transaction mismatch.',409);
   await deps.complete(id);
   return {ok:true,kind:'claim',payoutSignature:row.payout_signature,burned:row.burn_amount};
  }
  if(!paid){await broadcast(connection,row.payout_tx!);return {ok:false,kind:'claim',stage:'payout'};}
  // Compare-and-swap prevents a second worker from replacing an already replaced transaction.
  await deps.clearPayout(id,row.payout_signature);
 }
 const temporary=Keypair.generate(),latest=await connection.getLatestBlockhash('confirmed');
 const tx=payoutTransaction(master.publicKey,authority.publicKey,new PublicKey(row.wallet),new PublicKey(row.buyback_mint),BigInt(row.creator_amount),acquired,await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),temporary.publicKey);
 const signed=await versioned(connection,tx,master.publicKey,latest.blockhash,deps.tables,[master,authority,temporary]);
 if((await connection.simulateTransaction(signed,{sigVerify:true,commitment:'confirmed'})).value.err)throw new AppError('The buyback is complete. Payout is waiting for backend funding or retry; do not start a second claim.',409);
 const signature=bs58.encode(signed.signatures[0]),encoded=Buffer.from(signed.serialize()).toString('base64');
 await deps.savePayout(id,{encoded,signature,height:latest.lastValidBlockHeight,burn:acquired.toString()});
 row=(await deps.load(id))!;
 // Always send the durable winning transaction; simultaneous workers resend identical bytes.
 if(row.payout_tx&&!row.completed_at)await broadcast(connection,row.payout_tx);
 return {ok:false,kind:'claim',stage:'payout'};
}
