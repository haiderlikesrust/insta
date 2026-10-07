import {ASSOCIATED_TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {AddressLookupTableProgram,SystemProgram,ComputeBudgetProgram,Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {DYNAMIC_BONDING_CURVE_PROGRAM_ID,deriveDbcPoolAuthority,deriveDbcEventAuthority,deriveDbcPoolAddress,deriveDammV2PoolAddress,DAMM_V2_MIGRATION_FEE_ADDRESS} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {CpAmm,CP_AMM_PROGRAM_ID,derivePoolAuthority} from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import {createMetadata} from './token-metadata';
import {initialBuy} from './initial-buy';
import {assertDev} from './admin-auth';
import {AppError,draftSchema} from './domain';
import {config,db,readiness,type Session} from './server';
import {persist,poolRuntime,setupRuntime,type TokenRecord} from './chain';
import {buildInstaraCurve} from './curve';
import {NATIVE_MINT,TOKEN_PROGRAM} from './solana';
export const MAIN_TOKEN_ID='00000000-0000-4000-8000-000000000001';
const CONFIG_ID='00000000-0000-4000-8000-000000000002';
const LOOKUP_ID='00000000-0000-4000-8000-000000000003';
async function mainRecord(){return db().prepare("SELECT * FROM tokens WHERE id=? AND recipient_type='dev'").bind(MAIN_TOKEN_ID).first<TokenRecord>();}
export async function mainState(s:Session){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),token=await mainRecord();
 const pending=await db().prepare("SELECT id AS \"intentId\",signature,kind FROM intents WHERE token_id IN (?,?,?) AND wallet=? AND status='submitted' ORDER BY created_at DESC LIMIT 1").bind(MAIN_TOKEN_ID,CONFIG_ID,LOOKUP_ID,wallet).first();
 const pendingConfig=await db().prepare("SELECT id,status,kind FROM intents WHERE kind IN ('main_config','main_lookup') AND status IN ('prepared','submitted') ORDER BY created_at DESC LIMIT 1").first();
 return {wallet,token,pending,pendingConfig,enabled:readiness(true).live,configuredMint:config().INSTARA_MINT||null,meteoraConfig:config().METEORA_CONFIG_KEY||null,lookupTables:config().SOLANA_LOOKUP_TABLES||null};
}
export async function prepareConfiguration(s:Session){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS);
 if(config().METEORA_CONFIG_KEY)throw new AppError('The launch configuration is already saved.',409);
 if(await db().prepare("SELECT id FROM intents WHERE kind='main_config' AND status IN ('prepared','submitted')").first())throw new AppError('A configuration transaction is pending. Confirm it or recover it after expiry.',409);
 const {connection,client}=await setupRuntime(),payer=new PublicKey(wallet),account=Keypair.generate();
 const tx=await client.partner.createConfig({...buildInstaraCurve(),config:account.publicKey,feeClaimer:payer,leftoverReceiver:payer,payer,quoteMint:NATIVE_MINT});
 const placeholder={id:CONFIG_ID,wallet,name:'Instara configuration',symbol:'',creator_id:null,handle:'',metadata_uri:'',status:'draft',mint:null,vault:null};
 return persist(tx,[account],s,placeholder,'main_config',account.publicKey,payer,connection);
}
export async function recoverConfiguration(s:Session,lookup=false){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS);
 const pending=await db().prepare("SELECT id,mint,last_valid_height,signature FROM intents WHERE wallet=? AND kind=? AND status IN ('prepared','submitted') ORDER BY created_at DESC LIMIT 1").bind(wallet,lookup?'main_lookup':'main_config').first<{id:string;mint:string;last_valid_height:number;signature:string|null}>();
 if(!pending)throw new AppError('No pending configuration to recover.',404);
 const {connection}=await setupRuntime();
 if(await connection.getBlockHeight('finalized')<=pending.last_valid_height)throw new AppError('The transaction can still land. Wait until it expires.',409);
 if(await connection.getAccountInfo(new PublicKey(pending.mint),'finalized'))throw new AppError('The configuration exists. Confirm its transaction instead.',409);
 if(pending.signature){const result=await connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true});if(result.value[0]&&!result.value[0].err)throw new AppError('The transaction landed. Confirm it instead.',409);}
 await db().prepare("UPDATE intents SET status='expired' WHERE id=? AND status IN ('prepared','submitted')").bind(pending.id).run();return {ok:true};
}
export async function prepareMain(s:Session,input:unknown,appOrigin:string){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),e=config();
 if(e.INSTARA_MINT)throw new AppError('An INSTARA mint is already configured. A second main token cannot be launched.',409);
 const b=draftSchema.parse({...input as Record<string,unknown>,name:'Instara',symbol:'INSTARA',handle:'instara'});
 const {connection,client,configKey}=await poolRuntime(true);
 // A fixed primary key guarantees there is only one main launch across concurrent requests.
 await db().prepare("INSERT INTO tokens(id,recipient_type,wallet,name,symbol,description,handle,image,metadata_uri,status,created_at) VALUES(?,'dev',?,'Instara','INSTARA',?,'',?,?,'draft',?) ON CONFLICT(id) DO NOTHING").bind(MAIN_TOKEN_ID,wallet,b.description,b.image,'',Date.now()).run();
 let token=(await mainRecord())!;
 if(!token||token.wallet!==wallet||token.status!=='draft')throw new AppError('The main token is already launched or has a pending launch.',409);
 token=await db().prepare("UPDATE tokens SET description=?,image=?,website=?,twitter=?,telegram=?,dev_buy_sol=?,revision=revision+1 WHERE id=? AND status='draft' AND revision=? RETURNING *").bind(b.description,b.image,b.website,b.twitter,b.telegram,String(b.devBuySol),MAIN_TOKEN_ID,token.revision||0).first<TokenRecord>() as TokenRecord;
 if(!token)throw new AppError('The main launch changed. Refresh and try again.',409);
 const payer=new PublicKey(wallet),mint=Keypair.generate();
 const metadata=await createMetadata(token,mint.publicKey.toBase58(),appOrigin);
 const create=await client.creator.createPoolWithFirstBuy({createPoolParam:{baseMint:mint.publicKey,name:'Instara',symbol:'INSTARA',uri:metadata.uri,poolCreator:payer,payer,config:configKey},firstBuyParam:await initialBuy(client,payer,b.devBuySol)});
 token={...token,metadata_uri:metadata.uri};
 return persist(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...create.instructions),[mint],s,token,'main_launch',mint.publicKey,payer,connection);
}
export async function claimMain(s:Session){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),token=await mainRecord();
 if(!token||token.status!=='launched'||token.wallet!==wallet||!token.mint)throw new AppError('No main-token fees are available for this dev wallet.',409);
 const {connection,client,configKey}=await poolRuntime(true,false),payer=new PublicKey(wallet),mint=new PublicKey(token.mint),poolKey=deriveDbcPoolAddress(NATIVE_MINT,mint,configKey),pool=await client.state.getPool(poolKey);
 if(!pool||!pool.poolState.creator.equals(payer))throw new AppError('Main-token fee authority mismatch.',403);
 // Specify both budget fields before hashing/signing so wallets do not need to add a priority fee.
 // 700,000 CU at 10,000 micro-lamports costs at most 7,000 lamports in priority fees.
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:700000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
 if(!pool.poolState.creatorQuoteFee.isZero())tx.add(...(await client.creator.claimCreatorTradingFee({creator:payer,payer,pool:poolKey,maxBaseAmount:new BN(0),maxQuoteAmount:new BN('18446744073709551615')})).instructions);
 if(pool.poolState.isMigrated){
  const amm=new CpAmm(connection),poolAddress=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT),p=await amm.fetchPoolState(poolAddress);
  if(!p.tokenAMint.equals(mint)||!p.tokenBMint.equals(NATIVE_MINT))throw new AppError('Main-token pool mismatch.',403);
  for(const position of await amm.getUserPositionByPool(poolAddress,payer)){
   const fee=await amm.claimPositionFee({owner:payer,pool:poolAddress,position:position.position,positionNftAccount:position.positionNftAccount,tokenAMint:mint,tokenBMint:NATIVE_MINT,tokenAVault:p.tokenAVault,tokenBVault:p.tokenBVault,tokenAProgram:TOKEN_PROGRAM,tokenBProgram:TOKEN_PROGRAM});
   tx.add(...fee.instructions);
  }
 }
 if(tx.instructions.length===2)throw new AppError('No fees have accumulated yet.',409);
 return persist(tx,[],s,token,'main_claim',mint,payer,connection);
}

export async function prepareLookup(s:Session){
 const wallet=assertDev(s,config().DEV_WALLET_ADDRESS),e=config();
 if(e.SOLANA_LOOKUP_TABLES)throw new AppError('The transaction lookup table is already saved.',409);
 if(!e.INSTARA_MINT||!e.METEORA_CONFIG_KEY)throw new AppError('Launch INSTARA before setting up claims.',409);
 if(await db().prepare("SELECT id FROM intents WHERE kind='main_lookup' AND status IN ('prepared','submitted')").first())throw new AppError('A claim setup transaction is pending.',409);
 const {connection,client}=await setupRuntime(),payer=new PublicKey(wallet),mint=new PublicKey(e.INSTARA_MINT),cfg=new PublicKey(e.METEORA_CONFIG_KEY);
 const pool=deriveDbcPoolAddress(NATIVE_MINT,mint,cfg),state=await client.state.getPool(pool);
 if(!state)throw new AppError('The INSTARA pool is unavailable.',409);
 const addresses=[SystemProgram.programId,ComputeBudgetProgram.programId,TOKEN_PROGRAM,ASSOCIATED_TOKEN_PROGRAM_ID,NATIVE_MINT,mint,cfg,pool,state.poolState.baseVault,state.poolState.quoteVault,DYNAMIC_BONDING_CURVE_PROGRAM_ID,deriveDbcPoolAuthority(),deriveDbcEventAuthority(),CP_AMM_PROGRAM_ID,derivePoolAuthority(),PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],CP_AMM_PROGRAM_ID)[0],DAMM_V2_MIGRATION_FEE_ADDRESS[6]];
 const damm=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT);addresses.push(damm);
 if(state.poolState.isMigrated){const p=await new CpAmm(connection).fetchPoolState(damm);addresses.push(p.tokenAVault,p.tokenBVault);}
 const [create,table]=AddressLookupTableProgram.createLookupTable({authority:payer,payer,recentSlot:Math.max(0,(await connection.getSlot('finalized'))-1)});
 const extend=AddressLookupTableProgram.extendLookupTable({authority:payer,payer,lookupTable:table,addresses:[...new Map(addresses.map(a=>[a.toBase58(),a])).values()]});
 return persist(new Transaction().add(create,extend),[],s,{id:LOOKUP_ID,wallet,name:'Claim setup',symbol:'',creator_id:null,handle:'',metadata_uri:'',status:'draft',mint:null,vault:null},'main_lookup',table,payer,connection);
}
