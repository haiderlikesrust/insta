import { z } from "zod";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
export const FRESH_MS = 15 * 60 * 1000;
export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
const https = z.string().max(200).refine(v => !v || (v.startsWith("https://") && (() => { try { const u = new URL(v); return !u.username && !u.password; } catch { return false; } })()), "Use a valid HTTPS URL.");
export const devBuySchema = z.union([z.string().regex(/^\d{0,6}(\.\d{1,2})?$/), z.number().finite()]).default('0').transform(v => Number(v || 0)).pipe(z.number().min(0).max(100000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-7, 'Use at most two decimal places.'));
const imageUrl = z.union([https, z.string().regex(/^\/api\/media\/[a-f0-9]{64}$/)]);
export const draftSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(32).refine(v => new TextEncoder().encode(v).length <= 32, "Name must fit in 32 UTF-8 bytes."), symbol: z.string().regex(/^[A-Z0-9]{1,10}$/), handle: z.string().trim().transform(v => v.replace(/^@/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9._]{1,30}$/)), description: z.string().max(500), image: imageUrl, metadataUri: https.optional(), website: https.default(''), twitter: https.default(''), telegram: https.default(''), devBuyUsd: devBuySchema });
export function verifyWallet(message: string, signature: number[], wallet: string) { try { return signature.length === 64 && signature.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && nacl.sign.detached.verify(new TextEncoder().encode(message), Uint8Array.from(signature), new PublicKey(wallet).toBytes()); } catch { return false; } }
export async function hash(value: string | Uint8Array) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(x => x.toString(16).padStart(2, "0")).join(""); }
export function assertRecipient(creator: { id: string; username: string; profile_at: number } | null, handle: string, boundId: string | null, now = Date.now()) {
  if (!creator || creator.username.toLowerCase() !== handle.toLowerCase()) throw new AppError("Check this Instagram account before launching. The account must exist.");
  if (boundId && creator.id !== boundId) throw new AppError("The handle now belongs to a different account. This draft cannot be rerouted.");
  if (creator.profile_at < now - FRESH_MS || creator.profile_at > now) throw new AppError("Check the Instagram account again before launching.");
}
export function assertClaim(session: { creator_id: string | null; verified_at: number | null }, token: { creator_id: string | null }, now = Date.now()) {
  if (!session.creator_id || session.creator_id !== token.creator_id) throw new AppError("Only the original Instagram account can claim these fees.", 403);
  if (!session.verified_at || session.verified_at < now - FRESH_MS || session.verified_at > now) throw new AppError("Refresh Instagram verification before claiming.", 403);
}
