import type {Connection} from '@solana/web3.js';
import {AppError} from './domain';
export async function finalizedTransaction(connection:Pick<Connection,'getTransaction'|'getSignatureStatuses'|'getBlockHeight'>,signature:string,lastValidHeight:number){
 const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
 if(tx){if(!tx.meta||tx.meta.err)throw new AppError('The on-chain transaction failed. No launch or payout was recorded. Recover the expired setup or draft before trying again.',409);return tx;}
 const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
 if(status?.confirmationStatus==='finalized'&&status.err)throw new AppError('The on-chain transaction failed. Recover the expired setup or draft before trying again.',409);
 // An indexed landed signature can precede transaction history availability.
 if(!status&&await connection.getBlockHeight('finalized')>lastValidHeight)throw new AppError('This transaction expired without confirmation. Recover the expired setup or draft before trying again.',409);
 return null;
}
