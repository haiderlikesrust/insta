import {PublicKey} from '@solana/web3.js';
import {AppError} from './domain';
export function assertDev(session:{wallet:string}|null,configured:string|undefined){
 if(!session)throw new AppError('Connect the authorized dev wallet.',401);
 let expected:string;try{if(!configured)throw new Error();expected=new PublicKey(configured).toBase58();}catch{throw new AppError('Main-token access is unavailable.',503);}
 if(session.wallet!==expected)throw new AppError('This wallet cannot access the main-token launcher.',403);
 return expected;
}
