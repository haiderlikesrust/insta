import {Connection,PublicKey} from '@solana/web3.js';
import {config,db} from './server';
import {readFeeBalances,paidFees,feeUsd,type FeeBalances,type CompletedClaim} from './fee-balances';
import {solPrice} from './price';
import type {TokenRecord} from './chain';
const cache=new Map<string,{until:number;value:Promise<FeeBalances>}>();
async function balances(token:TokenRecord){
 const e=config();if(!e.SOLANA_RPC_URL||!e.METEORA_CONFIG_KEY||!token.mint||!token.vault)throw new Error('Fee data unavailable.');
 const key=`${token.mint}:${e.METEORA_CONFIG_KEY}:${token.vault}`,old=cache.get(key);if(old&&old.until>Date.now())return old.value;
 if(cache.size>=128)cache.delete(cache.keys().next().value!);
 const value=readFeeBalances(new Connection(e.SOLANA_RPC_URL,'confirmed'),new PublicKey(token.mint),new PublicKey(e.METEORA_CONFIG_KEY),new PublicKey(token.vault));
 cache.set(key,{until:Date.now()+15000,value});try{return await value;}catch(e){cache.delete(key);throw e;}
}
export async function tokenFees(token:TokenRecord&{claimed_at?:number|null}){
 const [chain,price,rows]=await Promise.all([
  balances(token).catch(()=>null),solPrice(),
  db().prepare("SELECT settlements.gross,settlements.creator_amount,settlements.buyback_amount,settlements.completed_at,intents.status FROM settlements JOIN intents ON intents.id=settlements.intent_id WHERE intents.token_id=? AND intents.kind='claim'").bind(token.id).all<CompletedClaim&{status:string}>()
 ]);
 const paid=paidFees(rows.results),isDev=token.recipient_type==='dev',claimed=isDev?chain?.collected??null:paid.gross,received=isDev?claimed:paid.paid;
 const amount=(value:string|null)=>({lamports:value,usd:feeUsd(value,price?.solUsd??null)});
 return {accountStatus:isDev?'dev':token.claimed_at?'claimed':'unclaimed',generated:amount(chain?.generated??null),available:amount(chain?.available??null),claimed:amount(claimed),paid:amount(received),buyback:amount(isDev?'0':paid.buyback),pendingClaims:rows.results.filter(r=>r.completed_at==null&&r.status==='submitted').length,chainAvailable:!!chain,priceAvailable:!!price,priceStale:price?.stale??false,asOf:Date.now()};
}
