import {Connection,Keypair,PublicKey,Transaction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {AppError} from './domain';
export async function versioned(connection:Connection,tx:Transaction,payer:PublicKey,blockhash:string,tableAddresses:string|undefined,signers:Keypair[]=[]){
 const tables=[];
 for(const address of (tableAddresses||'').split(',').map(s=>s.trim()).filter(Boolean)){
  const result=await connection.getAddressLookupTable(new PublicKey(address));
  if(!result.value||!result.value.isActive())throw new AppError('Transaction lookup table is unavailable.',503);
  tables.push(result.value);
 }
 const message=new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:tx.instructions}).compileToV0Message(tables);
 const result=new VersionedTransaction(message);if(signers.length)result.sign(signers);
 if(result.serialize().length>1232)throw new AppError('Transaction needs a configured Solana address lookup table. No funds were submitted.',503);
 return result;
}
export function validSignatures(tx:VersionedTransaction){const message=tx.message.serialize();return tx.signatures.length===tx.message.header.numRequiredSignatures&&tx.signatures.every((s,i)=>nacl.sign.detached.verify(message,s,tx.message.staticAccountKeys[i].toBytes()));}
export async function assertApprovedTransaction(tx:VersionedTransaction,wallet:string,messageHash:string){
 const {hash}=await import('./domain');
 if(tx.message.staticAccountKeys[0]?.toBase58()!==wallet)throw new AppError('The transaction uses a different wallet. Reconnect the authorized account.',403);
 if(await hash(tx.message.serialize())!==messageHash)throw new AppError('Your wallet changed the prepared transaction. Retry with the app-provided network fee unchanged. No transaction was submitted.',403);
 if(!validSignatures(tx))throw new AppError('The wallet returned a missing or invalid transaction signature. Reconnect and approve a fresh request. No transaction was submitted.',403);
}
