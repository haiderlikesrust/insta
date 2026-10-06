import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { AppError, assertRecipient, assertClaim, draftSchema, hash, verifyWallet } from "@/lib/domain";
import { db, session, origin, csrf, json, body, cookie, rateLimit, readiness, config } from "@/lib/server";
import { startBio, checkBio, bioStatus } from "@/lib/bio";
import { startRecipient, recipientStatus } from "@/lib/recipient";
import type { TokenRecord } from "@/lib/chain";
export const dynamic = "force-dynamic";
const pathOf = (r: Request) => new URL(r.url).pathname.replace(/^\/api\//, "");
async function handler(req: Request) {
  const path = pathOf(req), now = Date.now();
  if (req.method === "POST") { csrf(req); await rateLimit(`ip:${req.headers.get("cf-connecting-ip") || "local"}`, 60); }
  if (path === "state" && req.method === "GET") {
    const s = await session(req, false);
    const creators = await db().prepare("SELECT id, username, followers, biography, picture, claimed_at FROM creators WHERE profile_at > (strftime('%s','now') * 1000 - 900000) ORDER BY username LIMIT 200").all();
    const tokens = await db().prepare("SELECT tokens.*, creators.claimed_at FROM tokens LEFT JOIN creators ON creators.id=tokens.creator_id WHERE tokens.status='launched' ORDER BY tokens.created_at DESC LIMIT 100").all();
    const drafts = s ? await db().prepare("SELECT * FROM tokens WHERE wallet = ? AND status IN ('draft','pending') ORDER BY created_at DESC LIMIT 100").bind(s.wallet).all() : { results: [] };
    const pending = s ? await db().prepare("SELECT id AS intentId, signature FROM intents WHERE wallet=? AND status='submitted' ORDER BY created_at DESC LIMIT 1").bind(s.wallet).first() : null;
    const identity = s?.creator_id ? await db().prepare("SELECT id, username, followers, biography, picture FROM creators WHERE id = ?").bind(s.creator_id).first() : null;
    return json({ status: readiness(), creators: creators.results, tokens: tokens.results, drafts: drafts.results, wallet: s?.wallet, identity, pending });
  }
  if (path === "wallet/challenge" && req.method === "POST") {
    const { wallet } = z.object({ wallet: z.string().min(32).max(44) }).parse(await body(req)); new PublicKey(wallet); await rateLimit(`challenge:${wallet}`, 5);
    const id = crypto.randomUUID(); const message = `Fanfare wallet verification\nOrigin: ${origin(req)}\nWallet: ${wallet}\nNonce: ${id}\nExpires: ${new Date(now + 300000).toISOString()}\nThis proves ownership. It does not transfer funds.`;
    await db().prepare("INSERT INTO challenges (id,wallet,message,expires_at) VALUES (?,?,?,?)").bind(id, wallet, message, now + 300000).run(); return json({ id, message });
  }
  if (path === "wallet/verify" && req.method === "POST") {
    const b = z.object({ id: z.string().uuid(), signature: z.array(z.number().int().min(0).max(255)).length(64) }).parse(await body(req));
    const c = await db().prepare("SELECT * FROM challenges WHERE id = ? AND expires_at > ?").bind(b.id, now).first<{ id: string; wallet: string; message: string }>();
    if (!c || !verifyWallet(c.message, b.signature, c.wallet)) throw new AppError("Wallet signature is invalid or expired.", 401);
    const consumed = await db().prepare("DELETE FROM challenges WHERE id = ? AND expires_at > ? RETURNING id").bind(c.id, now).first(); if (!consumed) throw new AppError("This challenge was already used.", 401);
    const old = await session(req, false); if (old) await db().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(old.token_hash).run();
    const sameWallet = old?.wallet === c.wallet;
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`; await db().prepare("INSERT INTO sessions (token_hash,wallet,creator_id,verified_at,expires_at) VALUES (?,?,?,?,?)").bind(await hash(token), c.wallet, sameWallet ? old.creator_id : null, sameWallet ? old.verified_at : null, now + 86400000).run(); return json({ ok: true }, 200, { "Set-Cookie": cookie(req, token) });
  }
  if (path === "wallet/logout" && req.method === "POST") { const s = await session(req, false); if (s) await db().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(s.token_hash).run(); return json({ ok: true }, 200, { "Set-Cookie": cookie(req, "", 0) }); }
  if (path.startsWith("market/") && req.method === "GET") { const id = z.string().uuid().parse(path.split('/')[1]); const token = await db().prepare("SELECT * FROM tokens WHERE id=? AND status='launched'").bind(id).first<TokenRecord>(); if (!token) throw new AppError("Coin not found.",404); const {market}=await import('@/lib/chain'); return json({market:await market(token)}); }
  const s = (await session(req))!;
  if (path === "recipient/start" && req.method === "POST") return json(await startRecipient(s, await body(req)));
  if (path === "recipient/status" && req.method === "POST") return json(await recipientStatus(s, await body(req)));
  if (path === "bio/start" && req.method === "POST") return json(await startBio(s, await body(req)));
  if (path === "bio/check" && req.method === "POST") return json(await checkBio(s, await body(req)));
  if (path === "bio/status" && req.method === "POST") return json(await bioStatus(s));
  if (path === "drafts" && req.method === "POST") {
    const b = draftSchema.parse(await body(req)); const id = b.id || crypto.randomUUID();
    const old = b.id ? await db().prepare("SELECT * FROM tokens WHERE id = ? AND wallet = ?").bind(id, s.wallet).first<{ status: string; creator_id: string | null; handle: string }>() : null;
    if (b.id && (!old || old.status !== "draft")) throw new AppError("This draft cannot be edited.", 409);
    const c = await db().prepare("SELECT id FROM creators WHERE username = ?").bind(b.handle).first<{ id: string }>();
    if (old?.creator_id && old.handle === b.handle && c?.id && old.creator_id !== c.id) throw new AppError("This handle has changed owners. Create a new draft after verifying the intended account.", 409);
    if (old) await db().prepare("UPDATE tokens SET name=?,symbol=?,description=?,handle=?,creator_id=?,image=?,metadata_uri=? WHERE id=? AND wallet=? AND status='draft'").bind(b.name,b.symbol,b.description,b.handle,old.handle === b.handle ? old.creator_id || c?.id || null : c?.id || null,b.image,b.metadataUri,id,s.wallet).run();
    else await db().prepare("INSERT INTO tokens (id,wallet,name,symbol,description,handle,creator_id,image,metadata_uri,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'draft',?)").bind(id,s.wallet,b.name,b.symbol,b.description,b.handle,c?.id || null,b.image,b.metadataUri,now).run();
    return json({ id });
  }
  if (["launch/prepare", "claim/prepare", "launch/submit", "launch/confirm", "launch/recover"].includes(path) && req.method === "POST") {
    const chain = await import("@/lib/chain"); const b = await body(req); await rateLimit(`chain:${s.wallet}`, 10);
    if (path === "launch/submit") return json(await chain.submit(s, b));
    if (path === "launch/confirm") return json(await chain.confirm(s, b));
    if (path === "launch/recover") return json(await chain.recover(s, b));
    if (!readiness().live) throw new AppError("Live transactions are disabled until all integrations and escrow review are complete.", 503);
    const { id } = z.object({ id: z.string().uuid() }).parse(b);
    const token = await db().prepare("SELECT * FROM tokens WHERE id = ?").bind(id).first<TokenRecord>(); if (!token) throw new AppError("Coin not found.", 404);
    if (path === "launch/prepare") { if (token.wallet !== s.wallet || token.status !== "draft") throw new AppError("This coin cannot be launched again.", 409); const c = await db().prepare("SELECT * FROM creators WHERE id = ?").bind(token.creator_id).first<{ id: string; username: string; profile_at: number }>(); assertRecipient(c, token.handle, token.creator_id); if (!token.metadata_uri) throw new AppError("Add a permanent metadata URI before launch."); return json(await chain.prepareLaunch(s, token)); }
    assertClaim(s, token); if (token.status !== "launched") throw new AppError("This coin has not launched."); return json(await chain.prepareClaim(s, token));
  }
  throw new AppError("Not found.", 404);
}
async function safe(req: Request) { try { return await handler(req); } catch (e) { if (e instanceof AppError) return json({ error: e.message }, e.status); if (e instanceof z.ZodError) return json({ error: e.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400); console.error("Fanfare request failed", e instanceof Error ? e.name : "UnknownError"); return json({ error: "The service is temporarily unavailable. Your input has been preserved." }, 503); } }
export const GET = safe;
export const POST = safe;
