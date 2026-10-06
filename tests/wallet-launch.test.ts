import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectAddress,messageSignature,assertWalletAccount,walletProvider,walletError,type WalletProvider} from '../lib/browser-wallet';
import {formProblem} from '../lib/launch-validation';
import {assertMainnet} from '../lib/network';
const address={toString:()=> 'wallet'};
function provider(shape:'phantom'|'solflare'):WalletProvider{
 return {publicKey:address,connect:async()=>shape==='phantom'?{publicKey:address}:undefined,signMessage:async()=>shape==='phantom'?{signature:new Uint8Array(64)}:new Uint8Array(64),signTransaction:async t=>t};
}
test('Phantom and Solflare connect and message signature formats both work',async()=>{
 for(const shape of ['phantom','solflare'] as const){const p=provider(shape);assert.equal(await connectAddress(p),'wallet');assert.equal((await messageSignature(p,'verification')).length,64);assertWalletAccount(p,'wallet');}
 const p=provider('solflare');p.isSolflare=true;assert.equal(walletProvider('solflare',{solana:p}),p);assert.equal(walletProvider('phantom',{solana:p}),undefined);
});
test('missing accounts, changed accounts, malformed signatures and cancellations are surfaced',async()=>{
 const p=provider('solflare');p.publicKey=null;await assert.rejects(connectAddress(p),/did not return an account/);
 p.publicKey=address;assert.throws(()=>assertWalletAccount(p,'other'),/account changed/);
 p.signMessage=async()=>new Uint8Array(63);await assert.rejects(messageSignature(p,'proof'),/invalid signature/);
 assert.match(walletError({code:4001}),/cancelled/);
});
test('launch validation explains missing inputs and optional SOL buy errors',()=>{
 const f={name:'Coin',symbol:'COIN',handle:' creator ',image:'/api/media/image',website:'',twitter:'',telegram:'',devBuySol:'0.125'};
 assert.equal(formProblem(f,true,{checked:true,consent:true}),null);
 assert.match(formProblem({...f,image:''},true)!,/Upload/);
 assert.match(formProblem(f,true,{checked:false,consent:true})!,/Instagram/);
 assert.match(formProblem(f,true,{checked:true,consent:false})!,/endorsement/);
 assert.match(formProblem({...f,devBuySol:'0.0000000001'})!,/SOL/);
 assert.match(formProblem({...f,website:'bad-url'})!,/HTTPS/);
 assert.equal(formProblem({...f,image:''}),null);
});
test('network guard accepts the full mainnet genesis hash and rejects truncated or foreign hashes',async()=>{
 await assertMainnet({getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'});
 for(const hash of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','EtWTRABZaYq6iMfeYKouRu166VU2xqa1',''])await assert.rejects(assertMainnet({getGenesisHash:async()=>hash}),/not Solana mainnet/);
});
