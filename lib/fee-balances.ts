import {PublicKey,type Connection} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {DynamicBondingCurveClient,deriveDbcPoolAddress,deriveDammV2PoolAddress,DAMM_V2_MIGRATION_FEE_ADDRESS} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {CpAmm,getUnClaimLpFee} from '@meteora-ag/cp-amm-sdk';
export type FeeBalances={generated:string;available:string;collected:string};
export async function readFeeBalances(connection:Connection,mint:PublicKey,configKey:PublicKey,authority:PublicKey):Promise<FeeBalances>{
 const dbc=new DynamicBondingCurveClient(connection,'confirmed'),poolKey=deriveDbcPoolAddress(NATIVE_MINT,mint,configKey),pool=await dbc.state.getPool(poolKey);
 if(!pool||!pool.poolState.creator.equals(authority))throw new Error('Fee authority mismatch.');
 const breakdown=await dbc.state.getPoolFeeBreakdown(poolKey);
 let available=BigInt(breakdown.creator.unclaimedQuoteFee.toString()),collected=BigInt(breakdown.creator.claimedQuoteFee.toString()),generated=BigInt(breakdown.creator.totalQuoteFee.toString());
 if(pool.poolState.isMigrated){
  const amm=new CpAmm(connection),key=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT),state=await amm.fetchPoolState(key);
  if(!state.tokenAMint.equals(mint)||!state.tokenBMint.equals(NATIVE_MINT))throw new Error('Unexpected graduated pool.');
  const positions=await amm.getUserPositionByPool(key,authority);
  if(!positions.length)throw new Error('Creator liquidity position is unavailable.');
  for(const {positionState} of positions){
   const pending=BigInt(getUnClaimLpFee(state,positionState).feeTokenB.toString()),claimed=BigInt(positionState.metrics.totalClaimedBFee.toString());
   available+=pending;collected+=claimed;generated+=pending+claimed;
  }
 }
 return {generated:generated.toString(),available:available.toString(),collected:collected.toString()};
}
export type CompletedClaim={gross:string;creator_amount:string;buyback_amount:string;completed_at:number|null};
export function paidFees(claims:CompletedClaim[]){
 let gross=BigInt(0),paid=BigInt(0),buyback=BigInt(0),count=0;
 for(const c of claims){if(c.completed_at==null)continue;gross+=BigInt(c.gross);paid+=BigInt(c.creator_amount);buyback+=BigInt(c.buyback_amount);count++;}
 return {gross:gross.toString(),paid:paid.toString(),buyback:buyback.toString(),count};
}
export function feeUsd(lamports:string|null,price:number|null){return lamports===null||price===null?null:Number(lamports)/1e9*price;}
