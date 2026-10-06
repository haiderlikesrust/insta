import {ComputeBudgetProgram,Keypair,PublicKey,Transaction,TransactionInstruction,type Connection} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {DYNAMIC_BONDING_CURVE_PROGRAM_ID as DBC,deriveDbcPoolAddress,deriveDbcPoolAuthority,deriveDbcEventAuthority,deriveDammV2PoolAddress,DAMM_V2_MIGRATION_FEE_ADDRESS} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {CpAmm,CP_AMM_PROGRAM_ID as DAMM,derivePoolAuthority} from '@meteora-ag/cp-amm-sdk';
import bs58 from 'bs58';
import {AppError,assertClaim,hash} from './domain';
import {config,db,readiness,type Session} from './server';
import {poolRuntime,setupRuntime,type TokenRecord} from './chain';
import {backendWallet,feeWallet} from './custody';
import {NATIVE_MINT,TOKEN_PROGRAM,discriminator} from './solana';
import {buybackRoute,splitClaim} from './buyback';
import {versioned} from './transactions';

import type {Claim} from './settlement-engine';
async function record(id:string){return db().prepare('SELECT intents.*,settlements.* FROM intents JOIN settlements ON settlements.intent_id=intents.id WHERE intents.id=?').bind(id).first<Claim>();}
async function broadcast(connection:Connection,encoded:string){
 try{await connection.sendRawTransaction(Buffer.from(encoded,'base64'),{skipPreflight:false,maxRetries:3});}catch{/* Persisted signatures are reconciled before any replacement is built. */}
}
export async function prepareClaim(s:Session,token:TokenRecord){
 assertClaim(s,token);
 if(token.recipient_type==='dev'||token.status!=='launched'||!token.mint)throw new AppError('This token cannot use creator payouts.',403);
 const active=await db().prepare("SELECT id,wallet,signature FROM intents WHERE token_id=? AND kind='claim' AND status IN ('prepared','submitted')").bind(token.id).first<{id:string;wallet:string;signature:string}>();
 if(active){if(active.wallet!==s.wallet)throw new AppError('A payout to the previously verified wallet is still settling.',409);return {intentId:active.id,signature:active.signature};}
 if(!readiness().claimsLive)throw new AppError('Creator payouts are awaiting the INSTARA buyback setup. Your fees continue to accumulate for your account.',503);
 const {connection,client,configKey}=await poolRuntime(),master=backendWallet(config().BACKEND_WALLET_SECRET_KEY),mint=new PublicKey(token.mint),authority=feeWallet(master,mint),vault=authority.publicKey,payer=master.publicKey;
 if(token.vault!==vault.toBase58())throw new AppError('The configured backend key does not control this token’s fee wallet.',503);
 const poolKey=deriveDbcPoolAddress(NATIVE_MINT,mint,configKey),pool=await client.state.getPool(poolKey);
 if(!pool||!pool.poolState.creator.equals(vault))throw new AppError('Meteora fee authority mismatch.',403);
 const baseAta=getAssociatedTokenAddressSync(mint,vault),quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,vault);
 const collect:TransactionInstruction[]=[createAssociatedTokenAccountIdempotentInstruction(payer,baseAta,vault,mint),createAssociatedTokenAccountIdempotentInstruction(payer,quoteAta,vault,NATIVE_MINT)];
 const m=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
 if(!pool.poolState.creatorQuoteFee.isZero()){
  const amounts=Buffer.alloc(16);amounts.writeBigUInt64LE(BigInt('18446744073709551615'),8);
  collect.push(new TransactionInstruction({programId:DBC,keys:[m(deriveDbcPoolAuthority()),m(poolKey,true),m(baseAta,true),m(quoteAta,true),m(pool.poolState.baseVault,true),m(pool.poolState.quoteVault,true),m(mint),m(NATIVE_MINT),m(vault,false,true),m(TOKEN_PROGRAM),m(TOKEN_PROGRAM),m(deriveDbcEventAuthority()),m(DBC)],data:Buffer.concat([discriminator('claim_creator_trading_fee'),amounts])}));
 }
 if(pool.poolState.isMigrated){
  const amm=new CpAmm(connection),graduated=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT),state=await amm.fetchPoolState(graduated);
  if(!state.tokenAMint.equals(mint)||!state.tokenBMint.equals(NATIVE_MINT))throw new AppError('Unexpected graduated pool layout.',409);
  for(const position of await amm.getUserPositionByPool(graduated,vault))collect.push(new TransactionInstruction({programId:DAMM,keys:[m(derivePoolAuthority()),m(graduated),m(position.position,true),m(baseAta,true),m(quoteAta,true),m(state.tokenAVault,true),m(state.tokenBVault,true),m(mint),m(NATIVE_MINT),m(position.positionNftAccount),m(vault,false,true),m(TOKEN_PROGRAM),m(TOKEN_PROGRAM),m(PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],DAMM)[0]),m(DAMM)],data:discriminator('claim_position_fee')}));
 }
 const e=config(),latest=await connection.getLatestBlockhash('confirmed');
 const snapshot=await versioned(connection,new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:900000}),...collect),payer,latest.blockhash,e.SOLANA_LOOKUP_TABLES);
 const simulation=await connection.simulateTransaction(snapshot,{sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[quoteAta.toBase58()]}});
 const account=simulation.value.accounts?.[0];
 if(simulation.value.err||!account||account.owner!==TOKEN_PROGRAM.toBase58())throw new AppError('Fee collection could not be simulated. No payout was submitted.',409);
 const raw=Buffer.from(account.data[0],'base64');if(raw.length!==165)throw new AppError('Invalid fee account.',409);
 const split=splitClaim(raw.readBigUInt64LE(64)),route=await buybackRoute(connection,e,vault,split.buyback);
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1200000}),...collect,createAssociatedTokenAccountIdempotentInstruction(payer,getAssociatedTokenAddressSync(route.mint,vault),vault,route.mint),route.inner);
 const signed=await versioned(connection,tx,payer,latest.blockhash,e.SOLANA_LOOKUP_TABLES,[master,authority]);
 if((await connection.simulateTransaction(signed,{sigVerify:true,commitment:'confirmed'})).value.err)throw new AppError('Buyback simulation failed. No funds were submitted.',409);
 // One active claim per token, including across processes. Nothing is broadcast before both records commit.
 const id=crypto.randomUUID(),signature=bs58.encode(signed.signatures[0]),encoded=Buffer.from(signed.serialize()).toString('base64');
 try{await db().batch([
  db().prepare("INSERT INTO intents(id,token_id,wallet,kind,message_hash,mint,vault,signature,status,last_valid_height,created_at) VALUES(?,?,?,'claim',?,?,?,?, 'submitted',?,?)").bind(id,token.id,s.wallet,await hash(signed.message.serialize()),token.mint,token.vault,signature,latest.lastValidBlockHeight,Date.now()),
  db().prepare('INSERT INTO settlements(intent_id,buyback_mint,gross,creator_amount,buyback_amount,minimum_burn,collection_tx) VALUES(?,?,?,?,?,?,?)').bind(id,route.mint.toBase58(),split.gross.toString(),split.creator.toString(),split.buyback.toString(),route.minimum.toString(),encoded)
 ]);}catch{throw new AppError('A claim is already being prepared, or storage is unavailable. Refresh before trying again.',409);}
 await broadcast(connection,encoded);
 return {intentId:id,signature,feeBreakdown:{grossLamports:split.gross.toString(),creatorLamports:split.creator.toString(),buybackLamports:split.buyback.toString()}};
}

export async function settleClaim(id:string){
 const {settleClaimWith}=await import('./settlement-engine');
 const {connection}=await setupRuntime();
 return settleClaimWith(id,{
  connection,master:()=>backendWallet(config().BACKEND_WALLET_SECRET_KEY),tables:config().SOLANA_LOOKUP_TABLES,load:record,
  fail:id=>db().prepare("UPDATE intents SET status='failed' WHERE id=? AND status='submitted'").bind(id).run(),
  complete:id=>db().batch([db().prepare('UPDATE settlements SET completed_at=? WHERE intent_id=? AND completed_at IS NULL').bind(Date.now(),id),db().prepare("UPDATE intents SET status='confirmed' WHERE id=?").bind(id)]),
  clearPayout:(id,signature)=>db().prepare('UPDATE settlements SET payout_tx=NULL,payout_signature=NULL,payout_height=NULL WHERE intent_id=? AND payout_signature=? AND completed_at IS NULL').bind(id,signature).run(),
  savePayout:(id,v)=>db().prepare('UPDATE settlements SET payout_tx=?,payout_signature=?,payout_height=?,burn_amount=? WHERE intent_id=? AND payout_signature IS NULL AND completed_at IS NULL').bind(v.encoded,v.signature,v.height,v.burn,id).run(),
 });
}
export async function confirmClaim(id:string){
 const result=await settleClaim(id);
 if(!result.ok)return {ok:false,kind:'claim',message:result.stage==='buyback'?'Confirming the buyback automatically…':'Confirming the burn and creator payout automatically…'};
 return {...result,kind:'claim'};
}
export async function settlePending(){
 const rows=await db().prepare("SELECT intents.id FROM intents JOIN settlements ON settlements.intent_id=intents.id WHERE kind='claim' AND status='submitted' ORDER BY settlements.last_attempt_at,intents.created_at LIMIT 5").all<{id:string}>();
 let completed=0;for(const row of rows.results){try{if((await settleClaim(row.id)).ok)completed++;}catch{/* Leave durable state for the next attempt. No alternate recipient is selected. */}finally{await db().prepare('UPDATE settlements SET last_attempt_at=? WHERE intent_id=?').bind(Date.now(),row.id).run();}}
 return {checked:rows.results.length,completed};
}
