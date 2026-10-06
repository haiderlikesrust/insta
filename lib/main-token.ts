import {ComputeBudgetProgram,Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {deriveDbcPoolAddress,deriveDammV2PoolAddress,DAMM_V2_MIGRATION_FEE_ADDRESS} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {CpAmm} from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import {assertDev} from './admin-auth';
import {AppError,draftSchema} from './domain';
import {config,db,readiness,type Session} from './server';
import {persist,poolRuntime,type TokenRecord} from './chain';
import {NATIVE_MINT,TOKEN_PROGRAM} from './escrow';
export const MAIN_TOKEN_ID='00000000-0000-4000-8000-000000000001';
async function mainRecord(){return db().prepare("SELECT * FROM tokens WHERE id=? AND recipient_type='dev'").bind(MAIN_TOKEN_ID).first<TokenRecord>();}
export async function mainState(s:Session){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),token=await mainRecord();
 const pending=await db().prepare("SELECT id AS \"intentId\",signature,kind FROM intents WHERE token_id=? AND wallet=? AND status='submitted' ORDER BY created_at DESC LIMIT 1").bind(MAIN_TOKEN_ID,wallet).first();
 return {wallet,token,pending,enabled:readiness(true).live,configuredMint:config().INSTARA_MINT||null};
}
export async function prepareMain(s:Session,input:unknown){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),e=config();
 if(e.INSTARA_MINT)throw new AppError('An INSTARA mint is already configured. A second main token cannot be launched.',409);
 const b=draftSchema.parse({...input as Record<string,unknown>,name:'Instara',symbol:'INSTARA',handle:'instara'});
 if(!b.metadataUri)throw new AppError('Add the permanent INSTARA metadata URI.');
 const {connection,client,configKey}=await poolRuntime(true);
 // A fixed primary key guarantees there is only one main launch across concurrent requests.
 await db().prepare("INSERT INTO tokens(id,recipient_type,wallet,name,symbol,description,handle,image,metadata_uri,status,created_at) VALUES(?,'dev',?,'Instara','INSTARA',?,'',?,?,'draft',?) ON CONFLICT(id) DO NOTHING").bind(MAIN_TOKEN_ID,wallet,b.description,b.image,b.metadataUri,Date.now()).run();
 const token=(await mainRecord())!;
 if(!token||token.wallet!==wallet||token.status!=='draft')throw new AppError('The main token is already launched or has a pending launch.',409);
 await db().prepare("UPDATE tokens SET description=?,image=?,metadata_uri=? WHERE id=? AND status='draft'").bind(b.description,b.image,b.metadataUri,MAIN_TOKEN_ID).run();
 const payer=new PublicKey(wallet),mint=Keypair.generate();
 const create=await client.creator.createPool({baseMint:mint.publicKey,name:'Instara',symbol:'INSTARA',uri:b.metadataUri,poolCreator:payer,payer,config:configKey});
 return persist(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...create.instructions),[mint],s,token,'main_launch',mint.publicKey,payer,connection);
}
export async function claimMain(s:Session){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),token=await mainRecord();
 if(!token||token.status!=='launched'||token.wallet!==wallet||!token.mint)throw new AppError('No main-token fees are available for this dev wallet.',409);
 const {connection,client,configKey}=await poolRuntime(true),payer=new PublicKey(wallet),mint=new PublicKey(token.mint),poolKey=deriveDbcPoolAddress(NATIVE_MINT,mint,configKey),pool=await client.state.getPool(poolKey);
 if(!pool||!pool.poolState.creator.equals(payer))throw new AppError('Main-token fee authority mismatch.',403);
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:700000}));
 if(!pool.poolState.creatorQuoteFee.isZero())tx.add(...(await client.creator.claimCreatorTradingFee({creator:payer,payer,pool:poolKey,maxBaseAmount:new BN(0),maxQuoteAmount:new BN('18446744073709551615')})).instructions);
 if(pool.poolState.isMigrated){
  const amm=new CpAmm(connection),poolAddress=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT),p=await amm.fetchPoolState(poolAddress);
  if(!p.tokenAMint.equals(mint)||!p.tokenBMint.equals(NATIVE_MINT))throw new AppError('Main-token pool mismatch.',403);
  for(const position of await amm.getUserPositionByPool(poolAddress,payer)){
   const fee=await amm.claimPositionFee({owner:payer,pool:poolAddress,position:position.position,positionNftAccount:position.positionNftAccount,tokenAMint:mint,tokenBMint:NATIVE_MINT,tokenAVault:p.tokenAVault,tokenBVault:p.tokenBVault,tokenAProgram:TOKEN_PROGRAM,tokenBProgram:TOKEN_PROGRAM});
   tx.add(...fee.instructions);
  }
 }
 if(tx.instructions.length===1)throw new AppError('No fees have accumulated yet.',409);
 return persist(tx,[],s,token,'main_claim',mint,payer,connection);
}
