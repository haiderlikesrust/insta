import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, deriveDbcPoolAddress, deriveDbcPoolAuthority, deriveDbcEventAuthority, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS, getPriceFromSqrtPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, CP_AMM_PROGRAM_ID, derivePoolAuthority } from "@meteora-ag/cp-amm-sdk";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { buildInstaraCurve, ECONOMICS } from "./curve";
import { z } from "zod";
import bs58 from "bs58";
import { AppError, hash } from "./domain";
import { config, db, readiness, type Session } from "./server";
import { initializeVault, claimVault, vaultAddress, TOKEN_PROGRAM, NATIVE_MINT, identityHash, relayInstruction, discriminator } from "./escrow";
export type TokenRecord = { id: string; wallet: string; name: string; symbol: string; creator_id: string | null; handle: string; metadata_uri: string; status: string; mint: string | null; vault: string | null };
type Intent = { id: string; token_id: string; wallet: string; kind: string; message_hash: string; mint: string; vault: string; signature: string | null; status: string; last_valid_height: number };
async function runtime() {
  if (!readiness().live) throw new AppError("Live transactions are not enabled.", 503);
  const e = config(); if (e.SOLANA_NETWORK !== "mainnet-beta") throw new AppError("The launch integration requires mainnet. Test the escrow separately before enabling it.", 503);
  const connection = new Connection(e.SOLANA_RPC_URL!, "confirmed");
  if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new AppError("RPC network does not match Solana mainnet.", 503);
  const program = new PublicKey(e.ESCROW_PROGRAM_ID!); const verifier = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(e.VERIFIER_SECRET_KEY!)));
  if (verifier.publicKey.toBase58() !== e.VERIFIER_PUBLIC_KEY) throw new AppError("Verification authority configuration mismatch.", 503);
  const [account, dbc] = await connection.getMultipleAccountsInfo([program, DYNAMIC_BONDING_CURVE_PROGRAM_ID]); if (!account?.executable || !dbc?.executable) throw new AppError("Required on-chain programs are not deployed.", 503);
  const client = new DynamicBondingCurveClient(connection,"confirmed"), configKey = new PublicKey(e.METEORA_CONFIG_KEY!);
  const onchain = await client.state.getPoolConfig(configKey), expected = buildInstaraCurve();
  if (!onchain || !onchain.quoteMint.equals(NATIVE_MINT) || !onchain.sqrtStartPrice.eq(expected.sqrtStartPrice) || !onchain.migrationQuoteThreshold.eq(expected.migrationQuoteThreshold) || onchain.creatorTradingFeePercentage !== 100 || onchain.migrationFeeOption !== 6 || onchain.creatorPermanentLockedLiquidityPercentage !== 100 || onchain.collectFeeMode !== 0 || onchain.migratedCollectFeeMode !== 0 || onchain.migratedPoolBaseFeeMode !== 0 || onchain.migratedCompoundingFeeBps !== 0 || onchain.migrationFeePercentage !== 0 || onchain.tokenUpdateAuthority !== 1 || !onchain.preMigrationTokenSupply.eq(expected.tokenSupply!.preMigrationTokenSupply) || !onchain.postMigrationTokenSupply.eq(expected.tokenSupply!.postMigrationTokenSupply) || onchain.migrationOption !== 1 || onchain.tokenType !== 0 || onchain.tokenDecimal !== 6 || onchain.migratedPoolFeeBps !== 200 || onchain.migratedDynamicFee !== 0 || onchain.poolFees.baseFee.cliffFeeNumerator.toString() !== '20000000' || onchain.poolFees.baseFee.firstFactor !== 0 || !onchain.poolFees.baseFee.secondFactor.isZero() || !onchain.poolFees.baseFee.thirdFactor.isZero() || onchain.poolFees.dynamicFee.initialized !== 0) throw new AppError("Meteora config differs from the fixed 2% / 20-to-250 curve. Launch blocked.",503);
  return { connection, program, verifier, client, configKey };
}
async function persist(tx: Transaction, signers: Keypair[], s: Session, token: TokenRecord, kind: string, mint: PublicKey, vault: PublicKey, connection: Connection) {
  const latest = await connection.getLatestBlockhash("confirmed"); tx.recentBlockhash = latest.blockhash; tx.feePayer = new PublicKey(s.wallet); tx.partialSign(...signers);
  const serialized = tx.serialize({ requireAllSignatures: false }); if (serialized.length > 1232) throw new AppError("Transaction exceeds Solana’s size limit. Do not submit it; contact the operator.");
  const id = crypto.randomUUID();
  const simulation = await connection.simulateTransaction(VersionedTransaction.deserialize(serialized), { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
  if (simulation.value.err) throw new AppError("Transaction simulation failed. No funds were submitted; check escrow and pool configuration.",409);
  if (kind === "launch") { const locked = await db().prepare("UPDATE tokens SET status='pending',mint=?,vault=? WHERE id=? AND wallet=? AND status='draft' RETURNING id").bind(mint.toBase58(),vault.toBase58(),token.id,s.wallet).first(); if (!locked) throw new AppError("A launch is already pending for this draft.", 409); }
  try { await db().prepare("INSERT INTO intents (id,token_id,wallet,kind,message_hash,mint,vault,status,last_valid_height,created_at) VALUES (?,?,?,?,?,?,?,'prepared',?,?)").bind(id,token.id,s.wallet,kind,await hash(tx.serializeMessage()),mint.toBase58(),vault.toBase58(),latest.lastValidBlockHeight,Date.now()).run(); }
  catch (e) { if (kind === "launch") await db().prepare("UPDATE tokens SET status='draft',mint=NULL,vault=NULL WHERE id=? AND status='pending' AND mint=?").bind(token.id,mint.toBase58()).run(); throw e; }
  return { intentId: id, transaction: serialized.toString("base64"), mint: mint.toBase58(), vault: vault.toBase58(), lastValidBlockHeight: latest.lastValidBlockHeight };
}
export async function prepareLaunch(s: Session, token: TokenRecord) {
  const { connection, program, verifier, client, configKey } = await runtime(); const mint = Keypair.generate(), payer = new PublicKey(s.wallet), vault = vaultAddress(mint.publicKey, program);
  const create = await client.creator.createPool({ baseMint: mint.publicKey, name: token.name, symbol: token.symbol, uri: token.metadata_uri, poolCreator: vault, payer, config: configKey });
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }), initializeVault(program,payer,verifier.publicKey,mint.publicKey,token.creator_id!),...create.instructions.map(ix => ix.programId.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID) ? relayInstruction(program,verifier.publicKey,mint.publicKey,ix) : ix));
  return persist(tx,[mint,verifier],s,token,"launch",mint.publicKey,vault,connection);
}
export async function prepareClaim(s: Session, token: TokenRecord) {
  const { connection, program, verifier, client, configKey } = await runtime(); const mint = new PublicKey(token.mint!), vault = vaultAddress(mint,program), payer = new PublicKey(s.wallet);
  if (vault.toBase58() !== token.vault) throw new AppError("Vault address mismatch.", 409);
  const info = await connection.getAccountInfo(vault); if (!info || !info.owner.equals(program) || info.data.length !== 113 || !info.data.subarray(40,72).equals(identityHash(s.creator_id!))) throw new AppError("On-chain recipient does not match this Instagram account.", 403);
  const poolKey = deriveDbcPoolAddress(NATIVE_MINT,mint,configKey), pool = await client.state.getPool(poolKey);
  if (!pool || !pool.poolState.creator.equals(vault)) throw new AppError("Meteora pool creator does not match the vault.",403);
  const baseAta = getAssociatedTokenAddressSync(mint,vault,true), quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT,vault,true);
  const collect: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(payer,baseAta,vault,mint),createAssociatedTokenAccountIdempotentInstruction(payer,quoteAta,vault,NATIVE_MINT)];
  const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({pubkey,isWritable,isSigner});
  if (!pool.poolState.creatorQuoteFee.isZero()) {
    const amounts = Buffer.alloc(16); amounts.writeBigUInt64LE(BigInt("18446744073709551615"),8);
    const inner = new TransactionInstruction({ programId: DYNAMIC_BONDING_CURVE_PROGRAM_ID, keys: [meta(deriveDbcPoolAuthority()),meta(poolKey,true),meta(baseAta,true),meta(quoteAta,true),meta(pool.poolState.baseVault,true),meta(pool.poolState.quoteVault,true),meta(mint),meta(NATIVE_MINT),meta(vault,false,true),meta(TOKEN_PROGRAM),meta(TOKEN_PROGRAM),meta(deriveDbcEventAuthority()),meta(DYNAMIC_BONDING_CURVE_PROGRAM_ID)], data: Buffer.concat([discriminator("claim_creator_trading_fee"),amounts]) });
    collect.push(relayInstruction(program,verifier.publicKey,mint,inner));
  }
  if (pool.poolState.isMigrated) {
    const amm = new CpAmm(connection), graduated = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],mint,NATIVE_MINT), state = await amm.fetchPoolState(graduated);
    if (!state.tokenAMint.equals(mint) || !state.tokenBMint.equals(NATIVE_MINT)) throw new AppError("Unexpected graduated pool quote layout.",409);
    const positions = await amm.getUserPositionByPool(graduated,vault);
    for (const p of positions) {
      const inner = new TransactionInstruction({ programId: CP_AMM_PROGRAM_ID, keys: [meta(derivePoolAuthority()),meta(graduated),meta(p.position,true),meta(baseAta,true),meta(quoteAta,true),meta(state.tokenAVault,true),meta(state.tokenBVault,true),meta(mint),meta(NATIVE_MINT),meta(p.positionNftAccount),meta(vault,false,true),meta(TOKEN_PROGRAM),meta(TOKEN_PROGRAM),meta(PublicKey.findProgramAddressSync([Buffer.from("__event_authority")],CP_AMM_PROGRAM_ID)[0]),meta(CP_AMM_PROGRAM_ID)], data: discriminator("claim_position_fee") });
      collect.push(relayInstruction(program,verifier.publicKey,mint,inner));
    }
  }
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }),...collect,claimVault(program,payer,verifier.publicKey,mint,s.creator_id!,Math.floor(Date.now()/1000)+300));
  return persist(tx,[verifier],s,token,"claim",mint,vault,connection);
}
export async function submit(s: Session, input: unknown) {
  const b = z.object({ intentId: z.string().uuid(), transaction: z.string().max(2000) }).parse(input);
  const intent = await db().prepare("SELECT * FROM intents WHERE id=? AND wallet=?").bind(b.intentId,s.wallet).first<Intent>(); if (!intent) throw new AppError("Transaction request not found.",404);
  if (intent.signature) return { signature: intent.signature };
  const { connection } = await runtime(); const tx = Transaction.from(Buffer.from(b.transaction,"base64"));
  if (await hash(tx.serializeMessage()) !== intent.message_hash || tx.feePayer?.toBase58() !== s.wallet || !tx.verifySignatures()) throw new AppError("The signed transaction differs from the approved request.",403);
  if (await connection.getBlockHeight("confirmed") > intent.last_valid_height) throw new AppError("This transaction expired. Recover the pending draft before preparing a replacement.",409);
  // Store the deterministic signature BEFORE network submission so a timeout cannot hide a landed transaction.
  const signature = bs58.encode(tx.signature!); await db().prepare("UPDATE intents SET signature=?,status='submitted' WHERE id=? AND signature IS NULL").bind(signature,intent.id).run();
  try { await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }); }
  catch { return { signature, uncertain: true }; }
  return { signature };
}
export async function confirm(s: Session, input: unknown) {
  const b = z.object({ intentId: z.string().uuid(), signature: z.string().min(64).max(100) }).parse(input);
  const intent = await db().prepare("SELECT * FROM intents WHERE id=? AND wallet=?").bind(b.intentId,s.wallet).first<Intent>(); if (!intent || intent.signature !== b.signature) throw new AppError("Unknown transaction.",404);
  const { connection } = await runtime(); const tx = await connection.getTransaction(b.signature,{ commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!tx) throw new AppError("Transaction is not finalized yet. Check confirmation again shortly.",409);
  if (tx.meta?.err || !tx.meta) throw new AppError("The on-chain transaction failed. No launch or payout was recorded.",409);
  if (await hash(tx.transaction.message.serialize()) !== intent.message_hash) throw new AppError("On-chain transaction does not match this request.",403);
  const statements = [db().prepare("UPDATE intents SET status='confirmed' WHERE id=?").bind(intent.id)];
  if (intent.kind === "launch") statements.push(db().prepare("UPDATE tokens SET status='launched',signature=? WHERE id=? AND mint=? AND vault=?").bind(b.signature,intent.token_id,intent.mint,intent.vault));
  await db().batch(statements); return { ok: true, kind: intent.kind };
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
  const intent=await db().prepare("SELECT * FROM intents WHERE token_id=? AND wallet=? AND kind='launch' AND status IN ('prepared','submitted') ORDER BY created_at DESC LIMIT 1").bind(id,s.wallet).first<Intent>();
  if(!intent)throw new AppError("No recoverable pending launch found.",404);
  const {connection}=await runtime();
  if(await connection.getBlockHeight('finalized') <= intent.last_valid_height)throw new AppError("This launch can still land. Wait for its blockhash to expire before recovering it.",409);
  if(await connection.getAccountInfo(new PublicKey(intent.mint),'finalized'))throw new AppError("The mint exists on-chain. Confirm the existing launch; do not launch another coin.",409);
  if(intent.signature){const result=await connection.getSignatureStatuses([intent.signature],{searchTransactionHistory:true});if(result.value[0] && !result.value[0].err)throw new AppError("The transaction has landed. Check confirmation instead.",409);}
  await db().batch([db().prepare("UPDATE intents SET status='expired' WHERE id=?").bind(intent.id),db().prepare("UPDATE tokens SET status='draft',mint=NULL,vault=NULL WHERE id=? AND wallet=? AND status='pending'").bind(id,s.wallet)]);return {ok:true};
}
