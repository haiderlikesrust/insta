import type {Connection} from '@solana/web3.js';
import {AppError} from './domain';
export class TransactionOutcomeError extends AppError{
 constructor(public outcome:'failed'|'expired',message:string){super(message,409);}
}
export async function finalizedTransaction(connection:Pick<Connection,'getTransaction'|'getSignatureStatuses'|'getBlockHeight'>,signature:string,lastValidHeight:number){
 const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
 if(tx){if(!tx.meta)throw new AppError('Transaction details are temporarily unavailable.',503);if(tx.meta.err)throw new TransactionOutcomeError('failed','The on-chain transaction failed. No launch or payout was recorded. Recover the expired setup or draft before trying again.');return tx;}
 const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
 if(status?.confirmationStatus==='finalized'&&status.err)throw new TransactionOutcomeError('failed','The on-chain transaction failed. Recover the expired setup or draft before trying again.');
 // An indexed landed signature can precede transaction history availability.
 if(!status&&await connection.getBlockHeight('finalized')>lastValidHeight)throw new TransactionOutcomeError('expired','This transaction expired without confirmation. Recover the expired setup or draft before trying again.');
 return null;
}
