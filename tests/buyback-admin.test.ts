import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import {assertDev} from '../lib/admin-auth';
import {splitClaim,slippageBps} from '../lib/buyback';
import {claimVault,initializeBuyback,buybackAddress} from '../lib/escrow';
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
test('claim commits exact gross, minimum burn and target mint into the signed instruction',()=>{
 const [program,payer,verifier,mint,instara]=Array.from({length:5},()=>Keypair.generate().publicKey);
 const inner=new TransactionInstruction({programId:SystemProgram.programId,keys:[{pubkey:payer,isSigner:true,isWritable:true}],data:Buffer.alloc(0)});
 const claim=claimVault(program,payer,verifier,mint,'creator',123,{mint:instara,gross:BigInt(10000),minimum:BigInt(42),inner});
 assert.equal(claim.data.readBigUInt64LE(48),BigInt(10000));assert.equal(claim.data.readBigUInt64LE(56),BigInt(42));assert.ok(claim.keys[6].pubkey.equals(instara));assert.ok(claim.keys[5].pubkey.equals(buybackAddress(program)));assert.equal(claim.keys[12].isSigner,false);
 const setup=initializeBuyback(program,payer,verifier,instara);assert.ok(setup.keys[1].isSigner);assert.ok(setup.keys[3].pubkey.equals(instara));assert.equal(PublicKey.isOnCurve(buybackAddress(program).toBytes()),false);
});
test('versioned transaction signature checks reject modifications and missing signatures',async()=>{
 const payer=Keypair.generate(),recipient=Keypair.generate().publicKey;
 const tx=await versioned({} as any,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:1})),payer.publicKey,Keypair.generate().publicKey.toBase58(),undefined,[payer]);
 assert.equal(validSignatures(tx),true);tx.signatures[0][0]^=1;assert.equal(validSignatures(tx),false);
});
