import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {DynamicBondingCurveClient} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {AppError,devBuySchema} from './domain';
import {buildInstaraCurve} from './curve';
import {solLamports} from './sol-amount';
export function buyLamports(sol:string){return new BN(solLamports(sol).toString());}
export function quoteInitialBuy(client:DynamicBondingCurveClient,buyer:PublicKey,amount:BN){
 const quote=client.pool.getQuoteFromInputAmount({config:buildInstaraCurve(),swapBaseForQuote:false,amountIn:amount,slippageBps:100,hasReferral:false,eligibleForFirstSwapWithMinFee:false});
 if(!quote.minimumAmountOut || quote.minimumAmountOut.lte(new BN(0)))throw new AppError('Increase the initial buy amount.');
 return {buyer,receiver:buyer,buyAmount:amount,minimumAmountOut:quote.minimumAmountOut,referralTokenAccount:null};
}
export async function initialBuy(client:DynamicBondingCurveClient,buyer:PublicKey,value:string|undefined){
 const sol=devBuySchema.parse(value),amount=buyLamports(sol);if(amount.isZero())return undefined;
 try{return quoteInitialBuy(client,buyer,amount);}catch(e){if(e instanceof AppError)throw e;throw new AppError('This initial buy exceeds the available bonding curve. Reduce the amount.');}
}
