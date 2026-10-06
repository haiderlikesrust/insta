import {createHmac,timingSafeEqual} from 'node:crypto';
import {Keypair,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {ACCOUNT_SIZE,createInitializeAccountInstruction,createTransferInstruction,createCloseAccountInstruction,createBurnInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {AppError} from './domain';
import {TOKEN_PROGRAM,NATIVE_MINT} from './solana';

export function backendWallet(secret:string|undefined){
 try{
  if(!secret)throw new Error();
  const value=secret.trim();
  const bytes=value.startsWith('[')?JSON.parse(value):Array.from(bs58.decode(value));
  if(!Array.isArray(bytes)||bytes.length!==64||!bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255))throw new Error();
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
 }catch{throw new AppError('Configure a valid backend wallet private key.',503);}
}
// Stable, isolated fee authority for each mint. Never rotate the master without migrating authority.
export function feeWallet(master:Keypair,mint:PublicKey){
 return Keypair.fromSeed(createHmac('sha256',master.secretKey).update('instara:fee-wallet:v1:').update(mint.toBuffer()).digest());
}
export function workerAuthorization(secret:string,minute=Math.floor(Date.now()/60000)){
 return `${minute}:${createHmac('sha256',secret).update(`instara:settle:v1:${minute}`).digest('hex')}`;
}
export function validWorkerAuthorization(secret:string|undefined,value:string|null,now=Date.now()){
 if(!secret||!value)return false;
 const minute=Number(value.split(':')[0]);if(!Number.isInteger(minute)||Math.abs(minute-Math.floor(now/60000))>1)return false;
 const expected=Buffer.from(workerAuthorization(secret,minute)),actual=Buffer.from(value);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function purchasedAmount(tx:any,owner:PublicKey,mint:PublicKey){
 const amount=(items:any[]):bigint=>items.filter(x=>x.owner===owner.toBase58()&&x.mint===mint.toBase58()).reduce((n,x)=>n+BigInt(x.uiTokenAmount.amount),BigInt(0));
 const received=amount(tx.meta?.postTokenBalances||[])-amount(tx.meta?.preTokenBalances||[]);
 if(received<=BigInt(0))throw new AppError('The confirmed buyback has no verifiable token output.',409);
 return received;
}
export function payoutTransaction(payer:PublicKey,authority:PublicKey,recipient:PublicKey,mint:PublicKey,creator:bigint,burn:bigint,rent:number,temporary:PublicKey){
 if(creator<=BigInt(0)||burn<=BigInt(0))throw new AppError('Invalid settlement amount.',409);
 return new Transaction().add(
  createBurnInstruction(getAssociatedTokenAddressSync(mint,authority),mint,authority,burn),
  SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:temporary,space:ACCOUNT_SIZE,lamports:rent,programId:TOKEN_PROGRAM}),
  createInitializeAccountInstruction(temporary,NATIVE_MINT,authority),
  createTransferInstruction(getAssociatedTokenAddressSync(NATIVE_MINT,authority),temporary,authority,creator),
  // Rent is paid by the backend and refunded to it. Only the creator's fee share reaches their wallet.
  createCloseAccountInstruction(temporary,payer,authority),
  SystemProgram.transfer({fromPubkey:payer,toPubkey:recipient,lamports:creator}),
 );
}
