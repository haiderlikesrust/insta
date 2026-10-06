import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {DynamicBondingCurveClient} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {AppError,devBuySchema} from './domain';
import {buildInstaraCurve} from './curve';
import {solPrice} from './price';
export function buyLamports(usd:number,solUsd:number){
 if(!Number.isFinite(solUsd)||solUsd<=0)throw new AppError('The USD price is unavailable.',503);
 const amount=Math.floor(devBuySchema.parse(usd)/solUsd*1e9);
 if(!Number.isSafeInteger(amount)||amount<1)throw new AppError('The initial buy amount is too small.');
 return new BN(amount.toString());
}
export function quoteInitialBuy(client:DynamicBondingCurveClient,buyer:PublicKey,amount:BN){
 const quote=client.pool.getQuoteFromInputAmount({config:buildInstaraCurve(),swapBaseForQuote:false,amountIn:amount,slippageBps:100,hasReferral:false,eligibleForFirstSwapWithMinFee:false});
 if(!quote.minimumAmountOut || quote.minimumAmountOut.lte(new BN(0)))throw new AppError('Increase the initial buy amount.');
 return {buyer,receiver:buyer,buyAmount:amount,minimumAmountOut:quote.minimumAmountOut,referralTokenAccount:null};
}
export async function initialBuy(client:DynamicBondingCurveClient,buyer:PublicKey,value:string|number|undefined){
 const usd=devBuySchema.parse(value);if(!usd)return undefined;
 const price=await solPrice();if(!price||price.stale)throw new AppError('A fresh USD price is needed for the initial buy. Try again shortly.',503);
 try{return quoteInitialBuy(client,buyer,buyLamports(usd,price.solUsd));}catch(e){if(e instanceof AppError)throw e;throw new AppError('This initial buy exceeds the available bonding curve. Reduce the amount.');}
}
