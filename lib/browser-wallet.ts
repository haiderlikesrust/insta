import type {VersionedTransaction} from '@solana/web3.js';
type Address={toString():string};
export type WalletProvider={
 publicKey?:Address|null;isPhantom?:boolean;isSolflare?:boolean;
 connect():Promise<{publicKey?:Address}|void>;
 disconnect?():Promise<void>;
 signMessage(message:Uint8Array,encoding?:string):Promise<Uint8Array|{signature:Uint8Array}>;
 signTransaction(transaction:VersionedTransaction):Promise<VersionedTransaction>;
};
declare global{interface Window{phantom?:{solana?:WalletProvider};solflare?:WalletProvider;solana?:WalletProvider;}}
export function walletProvider(type:'phantom'|'solflare',target:Pick<Window,'phantom'|'solflare'|'solana'>){
 return type==='phantom'?(target.phantom?.solana||(target.solana?.isPhantom?target.solana:undefined)):(target.solflare||(target.solana?.isSolflare?target.solana:undefined));
}
export async function connectAddress(provider:WalletProvider){
 const result=await provider.connect(),address=result?.publicKey?.toString()||provider.publicKey?.toString();
 if(!address)throw new Error('Your wallet did not return an account. Unlock it and reconnect.');
 if(provider.publicKey&&provider.publicKey.toString()!==address)throw new Error('Your wallet account changed. Reconnect before continuing.');
 return address;
}
export async function messageSignature(provider:WalletProvider,message:string){
 const result=await provider.signMessage(new TextEncoder().encode(message),'utf8');
 const signature=result&&typeof result==='object'&&'signature' in result?result.signature:result;
 if(!ArrayBuffer.isView(signature)||signature.byteLength!==64)throw new Error('The wallet returned an invalid signature. Reconnect and try again.');
 return Array.from(new Uint8Array(signature.buffer,signature.byteOffset,signature.byteLength));
}
export function assertWalletAccount(provider:WalletProvider,wallet:string){
 if(provider.publicKey&&provider.publicKey.toString()!==wallet)throw new Error('Your wallet account changed. Reconnect the account you want to launch with.');
}
export function walletError(error:unknown){
 const code=(error as {code?:number})?.code,message=error instanceof Error?error.message:'';
 if(code===4001||/reject|cancel|declin/i.test(message))return 'Wallet request cancelled. Try again and approve the request in your wallet to continue.';
 return message||'The wallet request failed. Unlock your wallet and try again.';
}
