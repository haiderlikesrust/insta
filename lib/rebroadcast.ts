import {VersionedTransaction,type Connection} from '@solana/web3.js';
import bs58 from 'bs58';
import {hash,AppError} from './domain';
import {validSignatures} from './transactions';
type SignedIntent={id:string;wallet:string;signature:string|null;message_hash:string;signed_transaction?:string|null;status:string};
// Retries only the exact wallet-approved bytes. Never rebuild or sign a replacement.
export async function rebroadcast(intent:SignedIntent,connection:Pick<Connection,'sendRawTransaction'>,acquire:()=>Promise<boolean>){
 if(intent.status!=='submitted'||!intent.signed_transaction||!intent.signature)return false;
 const bytes=Buffer.from(intent.signed_transaction,'base64'),tx=VersionedTransaction.deserialize(bytes);
 if(bs58.encode(tx.signatures[0])!==intent.signature||tx.message.staticAccountKeys[0].toBase58()!==intent.wallet||await hash(tx.message.serialize())!==intent.message_hash||!validSignatures(tx))throw new AppError('Stored transaction verification failed. No retry was sent.',403);
 if(!await acquire())return false;
 try{await connection.sendRawTransaction(bytes,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:3});}catch{/* Retain the same signature until finality or proven expiry. */}
 return true;
}
