import { z } from "zod";
import { AppError } from "./domain";
import { db, config, rateLimit, type Session } from "./server";
import { BIO_TTL, bioCode, handleSchema, parseProfile } from "./bio-proof";
import { verificationWrites } from "./bio-store";
import { startProfileRead, readProfileResult } from "./profile-reader";
type Challenge = {id:string;session_hash:string;wallet:string;username:string;account_id:string|null;code:string;expires_at:number;phase:string;lookup_run_id:string|null;check_run_id:string|null;profile_json:string|null;error:string|null;created_at:number};
function token(){const t=config().APIFY_API_TOKEN;if(!t)throw new AppError("Instagram verification is currently unavailable. Please try again later.",503);return t;}
function view(c:Challenge|null){if(!c)return null;return {id:c.id,username:c.username,code:['ready','checking'].includes(c.phase)?c.code:null,expiresAt:c.expires_at,phase:c.expires_at<=Date.now()&&c.phase!=='verified'?'expired':c.phase,profile:c.profile_json?JSON.parse(c.profile_json):null,error:c.error};}
async function current(s:Session,id?:string){return db().prepare(`SELECT * FROM bio_challenges WHERE session_hash=? AND wallet=? ${id?'AND id=?':''} ORDER BY created_at DESC LIMIT 1`).bind(s.token_hash,s.wallet,...(id?[id]:[])).first<Challenge>();}
export async function profileAllowance(){const day=Math.floor(Date.now()/86400000);const r=await db().prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind(`profile-reads:${day}`,(day+2)*86400000).first<{count:number}>();if(!r||r.count>50)throw new AppError("Instagram checks have reached their daily limit. Please try again tomorrow.",429);}
export async function startBio(s:Session,input:unknown){
  const key=token(),{username}=z.object({username:handleSchema}).parse(input);await rateLimit(`bio-start:${s.wallet}`,3);
  const previous=await current(s);if(previous&&previous.username===username&&previous.expires_at>Date.now()&&['resolving','starting','ready','checking','starting_check'].includes(previous.phase))return {challenge:view(previous)};
  await profileAllowance();const id=crypto.randomUUID(),now=Date.now();
  await db().batch([db().prepare("UPDATE bio_challenges SET phase='cancelled' WHERE session_hash=? AND phase!='verified'").bind(s.token_hash),db().prepare("INSERT INTO bio_challenges(id,session_hash,wallet,username,code,expires_at,phase,created_at) VALUES(?,?,?,?,?,?,'starting',?)").bind(id,s.token_hash,s.wallet,username,bioCode(),now+BIO_TTL,now)]);
  try{const run=await startProfileRead(username,key);await db().prepare("UPDATE bio_challenges SET lookup_run_id=?,phase='resolving' WHERE id=? AND phase='starting'").bind(run,id).run();}
  catch(e){await db().prepare("UPDATE bio_challenges SET phase='failed',error=? WHERE id=?").bind("Could not read this profile. Try again.",id).run();throw e;}
  return {challenge:view(await current(s,id))};
}
export async function checkBio(s:Session,input:unknown){
  const key=token(),{id}=z.object({id:z.string().uuid()}).parse(input);await rateLimit(`bio-check:${s.wallet}`,3);const c=await current(s,id);
  if(!c||c.expires_at<=Date.now())throw new AppError("This code expired. Generate a new one.",409);
  if(['checking','starting_check','verified'].includes(c.phase))return {challenge:view(c)};
  if(c.phase!=='ready'||!c.account_id)throw new AppError("Wait for the profile check to finish first.",409);
  const lock=await db().prepare("UPDATE bio_challenges SET phase='starting_check',error=NULL WHERE id=? AND phase='ready' RETURNING id").bind(id).first();if(!lock)throw new AppError("A check is already in progress.",409);
  try{await profileAllowance();const run=await startProfileRead(c.username,key);await db().prepare("UPDATE bio_challenges SET check_run_id=?,phase='checking' WHERE id=? AND phase='starting_check'").bind(run,id).run();}
  catch(e){await db().prepare("UPDATE bio_challenges SET phase='ready' WHERE id=? AND phase='starting_check'").bind(id).run();throw e;}
  return {challenge:view(await current(s,id))};
}
export async function bioStatus(s:Session){
  const c=await current(s);if(!c||c.expires_at<=Date.now()||!['resolving','checking'].includes(c.phase))return {challenge:view(c)};
  await rateLimit(`bio-poll:${s.wallet}`,30);
  try{
    const run=c.phase==='resolving'?c.lookup_run_id:c.check_run_id;if(!run)throw new AppError("Profile check interrupted. Generate a new code.",409);
    const items=await readProfileResult(run,token());if(items===null)return {challenge:view(c)};
    const profile=parseProfile(items,c.username),now=Date.now();
    if(c.phase==='resolving')await db().prepare("UPDATE bio_challenges SET account_id=?,profile_json=?,phase='ready' WHERE id=? AND phase='resolving' AND expires_at>?").bind(profile.id,JSON.stringify(profile),c.id,now).run();
    else{
      // All writes share a transaction and require the still-unused challenge.
      await db().batch(verificationWrites(c,profile,s,now).map(w=>db().prepare(w.sql).bind(...w.args)));
    }
  }catch(e){
    const message=e instanceof AppError?e.message:"We couldn’t check your profile. Please try again.";
    const next=c.phase==='checking'&&e instanceof AppError&&e.status===422?'ready':'failed';
    await db().prepare("UPDATE bio_challenges SET phase=?,error=? WHERE id=? AND phase=?").bind(next,message,c.id,c.phase).run();
  }
  return {challenge:view(await current(s,c.id))};
}
