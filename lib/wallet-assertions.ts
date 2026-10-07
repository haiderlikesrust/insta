import type {VersionedTransaction} from '@solana/web3.js';

// Lighthouse's deployed assertion program. Only read-only account-info/token
// assertions (6 and 10) are allowed; never memory writes/closes or arbitrary CPI.
// https://github.com/Jac0xb/lighthouse/blob/main/programs/lighthouse/src/instruction.rs
export const LIGHTHOUSE='L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';

function describe(tx:VersionedTransaction){
 const m=tx.message;
 const lookups=m.addressTableLookups.map(l=>({key:l.accountKey.toBase58(),writable:[...l.writableIndexes],readonly:[...l.readonlyIndexes]}));
 // Stable table/index references avoid RPC resolution and remain exact even
 // when a wallet reorders the static account list. Lookup layouts cannot change.
 const keys=[...m.staticAccountKeys.map(k=>k.toBase58()),
  ...lookups.flatMap(l=>l.writable.map(i=>`lookup:${l.key}:${i}`)),
  ...lookups.flatMap(l=>l.readonly.map(i=>`lookup:${l.key}:${i}`))];
 if(new Set(keys).size!==keys.length)throw new Error('Duplicate account');
 const key=(i:number)=>{if(!Number.isInteger(i)||i<0||i>=keys.length)throw new Error('Invalid account index');return keys[i];};
 const accounts=keys.map((address,i)=>({address,signer:m.isAccountSigner(i),writable:m.isAccountWritable(i)}));
 const instructions=m.compiledInstructions.map(i=>({program:key(i.programIdIndex),accounts:i.accountKeyIndexes.map(key),data:Buffer.from(i.data).toString('hex')}));
 return {version:tx.version,blockhash:m.recentBlockhash,payer:keys[0],lookups,accounts,instructions};
}

export function onlyAppendedWalletAssertions(prepared:VersionedTransaction,signed:VersionedTransaction){
 try{
  const a=describe(prepared),b=describe(signed),same=(x:unknown,y:unknown)=>JSON.stringify(x)===JSON.stringify(y);
  if(a.version!==b.version||a.blockhash!==b.blockhash||a.payer!==b.payer||!same(a.lookups,b.lookups))return false;
  const original=new Map(a.accounts.map(k=>[k.address,k]));
  if(original.has(LIGHTHOUSE))return false;
  if(b.accounts.length!==a.accounts.length+1)return false;
  for(const account of b.accounts){
   if(account.address===LIGHTHOUSE){if(account.signer||account.writable)return false;}
   else if(!same(account,original.get(account.address)))return false;
  }
  const count=a.instructions.length,extra=b.instructions.slice(count);
  if(!same(a.instructions,b.instructions.slice(0,count))||extra.length<1||extra.length>3)return false;
  return extra.every(ix=>ix.program===LIGHTHOUSE&&ix.accounts.length===1&&original.has(ix.accounts[0])&&
   ix.data.length>=6&&ix.data.length<=1024&&['06','0a'].includes(ix.data.slice(0,2)));
 }catch{return false;}
}
