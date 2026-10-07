import {assertDev} from "./admin-auth";
import {backendWallet,feeWallet} from "./custody";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { DynamicBondingCurveClient, deriveDbcPoolAddress, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS, getPriceFromSqrtPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { buildInstaraCurve, ECONOMICS } from "./curve";
import { z } from "zod";
import bs58 from "bs58";
import { AppError, hash } from "./domain";
import { config, db, readiness, type Session } from "./server";
import {NATIVE_MINT} from "./solana";
import {versioned,assertApprovedTransaction} from './transactions';
import {createMetadata} from './token-metadata';
import {initialBuy} from './initial-buy';
import {assertMainnet} from './network';
import {finalizedTransaction,TransactionOutcomeError} from './finalized-transaction';
import {rebroadcast} from './rebroadcast';
export type TokenRecord = { revision?:number; description?:string; image?:string; website?:string; twitter?:string; telegram?:string; dev_buy_sol?:string; recipient_type?: string; id: string; wallet: string; name: string; symbol: string; creator_id: string | null; handle: string; metadata_uri: string; status: string; mint: string | null; vault: string | null };
type Intent = { id: string; token_id: string; wallet: string; kind: string; message_hash: string; mint: string; vault: string; signature: string | null; status: string; last_valid_height: number; signed_transaction?:string|null; prepared_transaction?:string|null; submitted_message_hash?:string|null };
export async function setupRuntime(){
 const e=config(); if(e.SOLANA_NETWORK !== "mainnet-beta"||!e.SOLANA_RPC_URL)throw new AppError("Configure your mainnet RPC before creating the launch configuration.",503);
 const connection=new Connection(e.SOLANA_RPC_URL!,"confirmed");
 await assertMainnet(connection);
 return {connection,client:new DynamicBondingCurveClient(connection,'confirmed')};
}
export async function poolRuntime(main = false, requireLaunchEnabled = true) {
 if (requireLaunchEnabled&&!readiness(main).live) throw new AppError("Live transactions are not enabled.", 503);
 if(!config().METEORA_CONFIG_KEY)throw new AppError('The launch configuration is missing.',503);
 const e=config(),{connection}=await setupRuntime();
  const client = new DynamicBondingCurveClient(connection,"confirmed"), configKey = new PublicKey(e.METEORA_CONFIG_KEY!);
  const onchain = await client.state.getPoolConfig(configKey), expected = buildInstaraCurve();
  if (!onchain || !onchain.quoteMint.equals(NATIVE_MINT) || !onchain.sqrtStartPrice.eq(expected.sqrtStartPrice) || !onchain.migrationQuoteThreshold.eq(expected.migrationQuoteThreshold) || onchain.creatorTradingFeePercentage !== 100 || onchain.migrationFeeOption !== 6 || onchain.creatorPermanentLockedLiquidityPercentage !== 100 || onchain.collectFeeMode !== 0 || onchain.migratedCollectFeeMode !== 0 || onchain.migratedPoolBaseFeeMode !== 0 || onchain.migratedCompoundingFeeBps !== 0 || onchain.migrationFeePercentage !== 0 || onchain.tokenUpdateAuthority !== 1 || !onchain.preMigrationTokenSupply.eq(expected.tokenSupply!.preMigrationTokenSupply) || !onchain.postMigrationTokenSupply.eq(expected.tokenSupply!.postMigrationTokenSupply) || onchain.migrationOption !== 1 || onchain.tokenType !== 0 || onchain.tokenDecimal !== 6 || onchain.migratedPoolFeeBps !== 200 || onchain.migratedDynamicFee !== 0 || onchain.poolFees.baseFee.cliffFeeNumerator.toString() !== '20000000' || onchain.poolFees.baseFee.firstFactor !== 0 || !onchain.poolFees.baseFee.secondFactor.isZero() || !onchain.poolFees.baseFee.thirdFactor.isZero() || onchain.poolFees.dynamicFee.initialized !== 0) throw new AppError("Meteora config differs from the fixed 2% / 20-to-250 curve. Launch blocked.",503);
 return {connection,client,configKey};
}
async function runtime(){
 const shared=await poolRuntime(),master=backendWallet(config().BACKEND_WALLET_SECRET_KEY);
 return {...shared,master};
}
export async function persist(tx: Transaction, signers: Keypair[], s: Session, token: TokenRecord, kind: string, mint: PublicKey, vault: PublicKey, connection: Connection) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const signed=await versioned(connection,tx,new PublicKey(s.wallet),latest.blockhash,config().SOLANA_LOOKUP_TABLES,signers);
  const serialized = Buffer.from(signed.serialize());
  const id = crypto.randomUUID();
  const simulation = await connection.simulateTransaction(signed, { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
  if (simulation.value.err) throw new AppError("Transaction simulation failed. No funds were submitted; check wallet funding and pool configuration.",409);
  if (["launch","main_launch"].includes(kind)) { const locked = await db().prepare("UPDATE tokens SET status='pending',mint=?,vault=?,metadata_uri=?,website=? WHERE id=? AND wallet=? AND status='draft' AND revision=? RETURNING id").bind(mint.toBase58(),vault.toBase58(),token.metadata_uri,token.website||'',token.id,s.wallet,token.revision||0).first(); if (!locked) throw new AppError("This draft changed or already has a pending launch. Refresh and try again.", 409); }
  try { await db().prepare("INSERT INTO intents (id,token_id,wallet,kind,message_hash,mint,vault,status,last_valid_height,created_at,prepared_transaction) VALUES (?,?,?,?,?,?,?,'prepared',?,?,?)").bind(id,token.id,s.wallet,kind,await hash(signed.message.serialize()),mint.toBase58(),vault.toBase58(),latest.lastValidBlockHeight,Date.now(),serialized.toString("base64")).run(); }
  catch (e) { if (["launch","main_launch"].includes(kind)) await db().prepare("UPDATE tokens SET status='draft',mint=NULL,vault=NULL WHERE id=? AND status='pending' AND mint=?").bind(token.id,mint.toBase58()).run(); throw e; }
  return { intentId: id, transaction: serialized.toString("base64"), mint: mint.toBase58(), vault: vault.toBase58(), lastValidBlockHeight: latest.lastValidBlockHeight };
}
export async function prepareLaunch(s:Session,token:TokenRecord,appOrigin:string){
 const {connection,client,configKey,master}=await runtime(),mint=Keypair.generate(),payer=new PublicKey(s.wallet),authority=feeWallet(master,mint.publicKey);
 const metadata=await createMetadata(token,mint.publicKey.toBase58(),appOrigin);
 const create=await client.creator.createPoolWithFirstBuy({createPoolParam:{baseMint:mint.publicKey,name:token.name,symbol:token.symbol,uri:metadata.uri,poolCreator:authority.publicKey,payer,config:configKey},firstBuyParam:await initialBuy(client,payer,token.dev_buy_sol)});
 token={...token,metadata_uri:metadata.uri};
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...create.instructions);
 // The fee authority only signs if Meteora requires it; these launch instructions cannot spend its balance.
 const signers=[mint];if(tx.instructions.some(ix=>ix.keys.some(k=>k.isSigner&&k.pubkey.equals(authority.publicKey))))signers.push(authority);
 return persist(tx,signers,s,token,'launch',mint.publicKey,authority.publicKey,connection);
}
export async function prepareClaim(s:Session,token:TokenRecord){return (await import('./custodial-claims')).prepareClaim(s,token);}
export async function submit(s: Session, input: unknown) {
  const b = z.object({ intentId: z.string().uuid(), transaction: z.string().max(2000) }).parse(input);
  const intent = await db().prepare("SELECT * FROM intents WHERE id=? AND wallet=?").bind(b.intentId,s.wallet).first<Intent>(); if (!intent) throw new AppError("Transaction request not found.",404);
  if(intent.kind==='claim')throw new AppError('Claim transactions are submitted by the backend.',403);
  if (intent.signature) return { signature: intent.signature };
  if(intent.kind.startsWith("main_"))assertDev(s,config().DEV_WALLET_ADDRESS);
  const { connection } = await (['main_config','main_lookup'].includes(intent.kind)?setupRuntime():intent.kind.startsWith("main_")?poolRuntime(true,intent.kind!=='main_claim'):runtime()); const tx = VersionedTransaction.deserialize(Buffer.from(b.transaction,"base64"));
  const submittedHash=await assertApprovedTransaction(tx,s.wallet,intent.message_hash,intent.kind==='main_claim'?intent.prepared_transaction:null);
  if (await connection.getBlockHeight("confirmed") > intent.last_valid_height) throw new AppError("This transaction expired. Recover the pending draft before preparing a replacement.",409);
  // Store the deterministic signature BEFORE network submission so a timeout cannot hide a landed transaction.
  const signature = bs58.encode(tx.signatures[0]); await db().prepare("UPDATE intents SET signature=?,signed_transaction=?,submitted_message_hash=?,last_broadcast_at=?,status='submitted' WHERE id=? AND signature IS NULL AND status='prepared'").bind(signature,Buffer.from(tx.serialize()).toString('base64'),submittedHash,Date.now(),intent.id).run();
  const stored=await db().prepare('SELECT signature,status FROM intents WHERE id=?').bind(intent.id).first<{signature:string|null;status:string}>();
  if(stored?.signature!==signature||stored.status!=='submitted')throw new AppError('This transaction is no longer active. Refresh before trying again.',409);
  try { await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment:'confirmed', maxRetries: 3 }); }
  catch { return { signature, uncertain: true }; }
  return { signature };
}
export async function confirm(s: Session, input: unknown) {
  const b = z.object({ intentId: z.string().uuid(), signature: z.string().min(64).max(100) }).parse(input);
  const intent = await db().prepare("SELECT * FROM intents WHERE id=? AND wallet=?").bind(b.intentId,s.wallet).first<Intent>(); if (!intent || intent.signature !== b.signature) throw new AppError("Unknown transaction.",404);
  if(intent.kind==='claim')return (await import('./custodial-claims')).confirmClaim(intent.id);
  if(intent.kind.startsWith("main_"))assertDev(s,config().DEV_WALLET_ADDRESS);
  const { connection } = await setupRuntime();
  let tx;
  try{tx=await finalizedTransaction(connection,b.signature,intent.last_valid_height);}catch(e){
   if(intent.kind!=='main_claim'||!(e instanceof TransactionOutcomeError))throw e;
   await db().prepare("UPDATE intents SET status=? WHERE id=? AND status IN ('prepared','submitted')").bind(e.outcome,intent.id).run();
   return {ok:false,status:e.outcome,kind:intent.kind,message:`The dev-fee claim ${e.outcome==='expired'?'expired before landing':'failed on Solana'}. No fees were paid by this transaction. Click Claim dev fees to approve a new attempt.`};
  }
  if (!tx){
   await rebroadcast(intent,connection,async()=>!!await db().prepare("UPDATE intents SET last_broadcast_at=? WHERE id=? AND status='submitted' AND last_broadcast_at<? RETURNING id").bind(Date.now(),intent.id,Date.now()-15000).first());
   return {ok:false,kind:intent.kind,message:'Confirming on Solana automatically…'};
  }
  if (await hash(tx.transaction.message.serialize()) !== (intent.submitted_message_hash||intent.message_hash)) throw new AppError("On-chain transaction does not match this request.",403);
  const statements = [db().prepare("UPDATE intents SET status='confirmed' WHERE id=?").bind(intent.id)];
  if (["launch","main_launch"].includes(intent.kind)) statements.push(db().prepare("UPDATE tokens SET status='launched',signature=?,launched_at=COALESCE(launched_at,?) WHERE id=? AND mint=? AND vault=?").bind(b.signature,tx.blockTime?tx.blockTime*1000:Date.now(),intent.token_id,intent.mint,intent.vault));
  if(['main_config','main_launch','main_lookup'].includes(intent.kind)){
    const key=intent.kind==='main_config'?'METEORA_CONFIG_KEY':intent.kind==='main_lookup'?'SOLANA_LOOKUP_TABLES':'INSTARA_MINT';
    const existing=config()[key];if(existing&&existing!==intent.mint)throw new AppError('A different deployment address is already configured. Resolve that conflict before confirmation.',409);
    statements.push(db().prepare('INSERT INTO deployment_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING').bind(key,intent.mint));
  }
  await db().batch(statements); return { ok: true, kind: intent.kind, mint:intent.mint };
}
export async function market(token: TokenRecord) {
  const e = config(); if (!e.SOLANA_RPC_URL || !e.METEORA_CONFIG_KEY || !token.mint) throw new AppError("Live market data is not configured.",503);
  const connection = new Connection(e.SOLANA_RPC_URL,"confirmed"), client = new DynamicBondingCurveClient(connection,"confirmed"), mint = new PublicKey(token.mint);
  const pool = await client.state.getPool(deriveDbcPoolAddress(NATIVE_MINT,mint,new PublicKey(e.METEORA_CONFIG_KEY))); if (!pool) throw new AppError("Pool data is unavailable.",503);
  let priceSol = getPriceFromSqrtPrice(pool.poolState.sqrtPrice,6,9).toNumber();
  if (pool.poolState.isMigrated) { const amm = new CpAmm(connection); const p = await amm.fetchPoolState(deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT)); if (!p.tokenAMint.equals(mint) || !p.tokenBMint.equals(NATIVE_MINT)) throw new AppError("Unexpected pool layout.",503); priceSol=getPriceFromSqrtPrice(p.sqrtPrice,6,9).toNumber(); }
  const {solPrice}=await import('./price');const price=await solPrice();return {priceUsd:price ? priceSol*price.solUsd : null,marketCapUsd:price ? priceSol*price.solUsd*ECONOMICS.supply : null,graduated:!!pool.poolState.isMigrated,stale:price?.stale??true};
}
export async function recover(s: Session, input: unknown) {
  const {id}=z.object({id:z.string().uuid()}).parse(input);
  const intent=await db().prepare("SELECT * FROM intents WHERE token_id=? AND wallet=? AND kind IN ('launch','main_launch') AND status IN ('prepared','submitted') ORDER BY created_at DESC LIMIT 1").bind(id,s.wallet).first<Intent>();
  if(!intent)throw new AppError("No recoverable pending launch found.",404);
  if(intent.kind.startsWith("main_"))assertDev(s,config().DEV_WALLET_ADDRESS);
 const {connection}=await (intent.kind.startsWith("main_")?poolRuntime(true):runtime());
  if(await connection.getBlockHeight('finalized') <= intent.last_valid_height)throw new AppError("This launch can still land. Wait for its blockhash to expire before recovering it.",409);
  if(await connection.getAccountInfo(new PublicKey(intent.mint),'finalized'))throw new AppError("The mint exists on-chain. Confirm the existing launch; do not launch another coin.",409);
  if(intent.signature){const result=await connection.getSignatureStatuses([intent.signature],{searchTransactionHistory:true});if(result.value[0] && !result.value[0].err)throw new AppError("The transaction has landed. Check confirmation instead.",409);}
  await db().batch([db().prepare("UPDATE intents SET status='expired' WHERE id=?").bind(intent.id),db().prepare("UPDATE tokens SET status='draft',mint=NULL,vault=NULL WHERE id=? AND wallet=? AND status='pending'").bind(id,s.wallet)]);return {ok:true};
}
