import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Connection,Keypair,ComputeBudgetProgram,Transaction,AddressLookupTableAccount} from '@solana/web3.js';
import {DynamicBondingCurveClient} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {TOKEN_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token';
import {buildInstaraCurve} from '../lib/curve';
import {buyLamports,initialBuy,quoteInitialBuy} from '../lib/initial-buy';
import {devBuySchema,draftSchema} from '../lib/domain';
import {metadataDocument} from '../lib/token-metadata';
import {sortCoins} from '../lib/coin-sort';
import {pairVolumes} from '../lib/volume';
import {versioned} from '../lib/transactions';

test('USD initial buy validation rejects negative, nonfinite and excessive precision; zero skips price and purchase',async()=>{
 for(const value of [-1,Infinity,NaN,'1.234','-5','1e5',100001])assert.throws(()=>devBuySchema.parse(value));
 assert.equal(buyLamports(25,100).toString(),'250000000');assert.throws(()=>buyLamports(1,0));
 assert.equal(await initialBuy({} as any,Keypair.generate().publicKey,''),undefined);
});
test('generated metadata uses the actual mint for its default website and preserves explicit socials',()=>{
 const mint=Keypair.generate().publicKey.toBase58(),t={name:'Coin',symbol:'COIN',description:'Description',image:'/api/media/'+'a'.repeat(64),handle:'creator',twitter:'https://x.com/creator'};
 const result=metadataDocument(t,mint,'https://instara.xyz');assert.equal(result.external_url,`https://instara.xyz/token/${mint}`);assert.equal(result.extensions.website,result.external_url);assert.equal(result.image,'https://instara.xyz'+t.image);assert.equal(result.extensions.instagram,'https://www.instagram.com/creator/');assert.equal(result.extensions.twitter,t.twitter);
 assert.equal(metadataDocument({...t,website:'https://example.com',recipient_type:'dev'},mint,'https://instara.xyz').extensions.instagram,undefined);
 assert.equal(metadataDocument({...t,website:'https://example.com'},mint,'https://instara.xyz').external_url,'https://example.com');
 assert.throws(()=>draftSchema.parse({...t,website:'javascript:alert(1)'}));
});
test('volume sorting keeps unknown after zero; date sorting follows launch time',()=>{
 const coins=[{id:'a',mint:'A',created_at:1,launched_at:30},{id:'b',mint:'B',created_at:2,launched_at:20},{id:'c',mint:'C',created_at:3,launched_at:10}];
 assert.deepEqual(sortCoins(coins,'newest').map(c=>c.id),['a','b','c']);assert.deepEqual(sortCoins(coins,'oldest').map(c=>c.id),['c','b','a']);assert.deepEqual(sortCoins(coins,'volume',{A:null,B:0,C:50}).map(c=>c.id),['c','b','a']);assert.equal(coins[0].id,'a');
 const pair={chainId:'solana',pairAddress:'pool',baseToken:{address:'A'},volume:{h24:50}};assert.deepEqual(pairVolumes([pair,pair,{...pair,pairAddress:'p2',volume:{h24:10}},{...pair,chainId:'ethereum'}],['A','B']),{A:60,B:null});
});
test('SDK first buy quotes protected output and keeps buyer separate from the creator fee wallet',async()=>{
 const connection=new Connection('http://127.0.0.1:8899'),client=new DynamicBondingCurveClient(connection,'confirmed'),buyer=Keypair.generate(),mint=Keypair.generate(),authority=Keypair.generate(),config=Keypair.generate().publicKey;
 const cfg={...buildInstaraCurve(),quoteMint:NATIVE_MINT};
 (client.creator as any).getPoolConfigForNewPool=async()=>cfg;
 connection.getAccountInfo=async(key)=>key.equals(NATIVE_MINT)?{owner:TOKEN_PROGRAM_ID,data:Buffer.alloc(82),executable:false,lamports:1,rentEpoch:0}:null;
 const firstBuy=quoteInitialBuy(client,buyer.publicKey,buyLamports(25,100));assert.ok(firstBuy.minimumAmountOut.gtn(0));assert.equal(firstBuy.receiver.toBase58(),buyer.publicKey.toBase58());assert.throws(()=>quoteInitialBuy(client,buyer.publicKey,buyLamports(100000,1)));
 for(const creator of [buyer.publicKey,authority.publicKey]){
 const create=await client.creator.createPoolWithFirstBuy({createPoolParam:{baseMint:mint.publicKey,name:'Instara',symbol:'INSTARA',uri:'https://instara.xyz/api/metadata/'+'a'.repeat(64),poolCreator:creator,payer:buyer.publicKey,config},firstBuyParam:firstBuy});
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...create.instructions);
 const required=new Set(tx.instructions.flatMap(ix=>ix.keys.filter(k=>k.isSigner).map(k=>k.pubkey.toBase58())));assert.ok(required.has(buyer.publicKey.toBase58()));
 const plain=await versioned(connection,tx,buyer.publicKey,Keypair.generate().publicKey.toBase58(),undefined,[mint,...(required.has(authority.publicKey.toBase58())?[authority]:[])]);assert.ok(plain.serialize().length<=1232,'Initial buy must fit without a pre-existing lookup table');
 const common=[TOKEN_PROGRAM_ID,NATIVE_MINT,config,...tx.instructions.flatMap(ix=>[ix.programId,...ix.keys.filter(k=>!k.isSigner).map(k=>k.pubkey)])];
 const table=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{deactivationSlot:BigInt('18446744073709551615'),lastExtendedSlot:0,lastExtendedSlotStartIndex:0,addresses:[...new Map(common.map(k=>[k.toBase58(),k])).values()]}});
 connection.getAddressLookupTable=async()=>({context:{slot:1},value:table});
 const signed=await versioned(connection,tx,buyer.publicKey,Keypair.generate().publicKey.toBase58(),table.key.toBase58(),[mint,...(required.has(authority.publicKey.toBase58())?[authority]:[])]);assert.ok(signed.serialize().length<=1232);
 console.log('First buy transaction with table:',creator.equals(buyer.publicKey)?'admin':'community',signed.serialize().length);
 }
});
