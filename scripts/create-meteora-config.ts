// Preparation only. No transaction is submitted and no payer secret is loaded.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildInstaraCurve } from "../lib/curve";
import { NATIVE_MINT } from "../lib/escrow";
const rpc = process.env.SOLANA_RPC_URL, payerAddress = process.env.CONFIG_PAYER_PUBLIC_KEY;
if (!rpc || !payerAddress) throw new Error("Set SOLANA_RPC_URL and CONFIG_PAYER_PUBLIC_KEY (public key only).");
const connection = new Connection(rpc,"confirmed"), client = new DynamicBondingCurveClient(connection,"confirmed"), payer = new PublicKey(payerAddress), config = Keypair.generate();
const curve = buildInstaraCurve();
const tx = await client.partner.createConfig({ ...curve, config: config.publicKey, feeClaimer: payer, leftoverReceiver: payer, payer, quoteMint: NATIVE_MINT });
tx.feePayer = payer; const latest = await connection.getLatestBlockhash(); tx.recentBlockhash = latest.blockhash; tx.partialSign(config);
mkdirSync("outputs",{recursive:true}); writeFileSync("outputs/meteora-config-transaction.json",JSON.stringify({ config: config.publicKey.toBase58(), payer: payer.toBase58(), lastValidBlockHeight: latest.lastValidBlockHeight, transaction: tx.serialize({requireAllSignatures:false}).toString("base64"), terms: { feeBps:200, initialMarketCapSol:20, graduationMarketCapSol:250, supply:1e9, creatorShareOfNonProtocolFees:100, dynamicFees:false } },null,2));
console.log("Prepared outputs/meteora-config-transaction.json. Review and sign before expiration. Nothing submitted.");
