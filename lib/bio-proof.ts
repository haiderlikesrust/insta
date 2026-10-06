import { z } from "zod";
import { AppError } from "./domain";
export const BIO_TTL = 15 * 60 * 1000;
export const handleSchema = z.string().trim().transform(v => v.replace(/^@/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9._]{1,30}$/));
const profileSchema = z.object({ id: z.string().regex(/^\d+$/), username: handleSchema, biography: z.string().max(1000), private: z.literal(false), followersCount: z.number().int().nonnegative().optional(), profilePicUrl: z.string().url().optional(), fullName: z.string().max(200).optional() });
export type BioProfile = { id: string; username: string; biography: string; followers: number | null; picture: string | null; name: string };
export function parseProfile(items: unknown, username: string): BioProfile {
  if (!Array.isArray(items) || items.length !== 1) throw new AppError("We couldn’t read this Instagram profile. Check the handle and make sure the account is public.", 422);
  const p = profileSchema.safeParse(items[0]);
  if (!p.success || p.data.username !== username) throw new AppError("We couldn’t confirm this public Instagram account. Private, missing, or unreadable accounts cannot be verified.", 422);
  const d=p.data;
  // Namespace public IDs separately from the retired Meta OAuth integration's scoped IDs.
  return { id: `instagram-public:${d.id}`, username:d.username, biography:d.biography, followers:d.followersCount ?? null, picture:d.profilePicUrl?.startsWith('https://') ? d.profilePicUrl : null, name:d.fullName || d.username };
}
export function bioCode() { return `INSTARA-${Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join('')}`; }
export function assertBioProof(challenge: { account_id:string|null; username:string; code:string; expires_at:number; phase:string; wallet:string; session_hash:string }, profile:BioProfile, wallet:string, sessionHash:string, now=Date.now()) {
  if(challenge.phase !== 'checking' || challenge.expires_at <= now) throw new AppError("This code expired or was already used. Generate a new code.",409);
  if(challenge.wallet !== wallet || challenge.session_hash !== sessionHash) throw new AppError("This code belongs to another wallet session.",403);
  if(!challenge.account_id || challenge.account_id !== profile.id || challenge.username !== profile.username) throw new AppError("The account identity changed. This verification cannot be rerouted.",403);
  if(!new RegExp(`(?:^|[^A-Za-z0-9_-])${challenge.code}(?=$|[^A-Za-z0-9_-])`).test(profile.biography)) throw new AppError("Code not found in your bio. Save the exact code on Instagram, then check again.",422);
}
