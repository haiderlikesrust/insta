import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const discriminator = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
export const identityHash = (instagramId: string) => createHash("sha256").update(`fanfare:instagram:v1:${instagramId}`).digest();
export const vaultAddress = (mint: PublicKey, program: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), mint.toBuffer()], program)[0];
export const vaultAta = (vault: PublicKey) => PublicKey.findProgramAddressSync([vault.toBuffer(), TOKEN_PROGRAM.toBuffer(), NATIVE_MINT.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
export function relayInstruction(program: PublicKey, verifier: PublicKey, mint: PublicKey, inner: TransactionInstruction) {
  const vault = vaultAddress(mint,program), length = Buffer.alloc(4); length.writeUInt32LE(inner.data.length);
  return new TransactionInstruction({ programId: program, keys: [{ pubkey: verifier, isSigner: true, isWritable: false }, { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: inner.programId, isSigner: false, isWritable: false }, ...inner.keys.map(k => ({ ...k, isSigner: k.pubkey.equals(vault) ? false : k.isSigner }))], data: Buffer.concat([discriminator("execute_meteora"),length,inner.data]) });
}
export function initializeVault(program: PublicKey, payer: PublicKey, verifier: PublicKey, mint: PublicKey, accountId: string) {
  return new TransactionInstruction({ programId: program, keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: verifier, isSigner: true, isWritable: false }, { pubkey: vaultAddress(mint, program), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data: Buffer.concat([discriminator("initialize_vault"), mint.toBuffer(), identityHash(accountId)]) });
}
export function claimVault(program: PublicKey, recipient: PublicKey, verifier: PublicKey, mint: PublicKey, accountId: string, expires: number) {
  const vault = vaultAddress(mint, program), expiry = Buffer.alloc(8); expiry.writeBigInt64LE(BigInt(expires));
  return new TransactionInstruction({ programId: program, keys: [{ pubkey: recipient, isSigner: true, isWritable: true }, { pubkey: verifier, isSigner: true, isWritable: false }, { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: vaultAta(vault), isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }], data: Buffer.concat([discriminator("claim"), identityHash(accountId), expiry]) });
}
