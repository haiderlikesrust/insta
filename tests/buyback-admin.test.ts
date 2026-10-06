import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import {assertDev} from '../lib/admin-auth';
import {splitClaim,slippageBps} from '../lib/buyback';
import {versioned,validSignatures} from '../lib/transactions';
test('main launcher rejects anonymous, wrong-wallet and missing allowlist access',()=>{
 const dev=Keypair.generate().publicKey.toBase58(),other=Keypair.generate().publicKey.toBase58();
 assert.throws(()=>assertDev(null,dev));assert.throws(()=>assertDev({wallet:other},dev));assert.throws(()=>assertDev({wallet:dev},undefined));assert.throws(()=>assertDev({wallet:dev},'invalid'));
 assert.equal(assertDev({wallet:dev},dev),dev);
});
test('claim deduction conserves lamports with creator-favorable rounding and rejects dust/overflow',()=>{
 for(const value of ['10000','10009','1000000000','18446744073709551615']){const n=BigInt(value),s=splitClaim(n);assert.equal(s.buyback,n/BigInt(10));assert.equal(s.creator+s.buyback,n);}
 assert.throws(()=>splitClaim(BigInt(9999)));assert.throws(()=>splitClaim(BigInt('18446744073709551616')));assert.throws(()=>slippageBps('301'));assert.throws(()=>slippageBps('0'));assert.equal(slippageBps(undefined),100);
});
test('versioned transaction signature checks reject modifications and missing signatures',async()=>{
 const payer=Keypair.generate(),recipient=Keypair.generate().publicKey;
 const tx=await versioned({} as any,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:1})),payer.publicKey,Keypair.generate().publicKey.toBase58(),undefined,[payer]);
 assert.equal(validSignatures(tx),true);tx.signatures[0][0]^=1;assert.equal(validSignatures(tx),false);
});
