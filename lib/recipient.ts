import { z } from 'zod';
import { db, config, rateLimit, type Session } from './server';
import { AppError, FRESH_MS } from './domain';
import { handleSchema, parseProfile } from './bio-proof';
import { recipientWrites } from './bio-store';
import { startProfileRead, readProfileResult } from './profile-reader';
import { profileAllowance } from './bio';
type Lookup={id:string;session_hash:string;wallet:string;username:string;run_id:string|null;phase:string;error:string|null;created_at:number};
async function creator(username:string){return db().prepare('SELECT id,username,followers,biography,picture,claimed_at,profile_at FROM creators WHERE username=?').bind(username).first();}
function apiToken(){const key=config().APIFY_API_TOKEN;if(!key)throw new AppError('Instagram account lookup is currently unavailable. Please try again later.',503);return key;}
export async function startRecipient(s:Session,input:unknown){
 const key=apiToken(),{username}=z.object({username:handleSchema}).parse(input);await rateLimit(`recipient:${s.wallet}`,3);
 const cached=await creator(username);if(cached&&Number(cached.profile_at)>Date.now()-60000)return {lookup:{phase:'found',username},profile:cached};
 const active=await db().prepare("SELECT * FROM recipient_lookups WHERE session_hash=? AND username=? AND phase IN ('starting','reading') AND created_at>? ORDER BY created_at DESC LIMIT 1").bind(s.token_hash,username,Date.now()-180000).first<Lookup>();if(active)return {lookup:{id:active.id,phase:active.phase,username},profile:null};
 await profileAllowance();const id=crypto.randomUUID();await db().prepare("INSERT INTO recipient_lookups(id,session_hash,wallet,username,phase,created_at) VALUES(?,?,?,?,'starting',?)").bind(id,s.token_hash,s.wallet,username,Date.now()).run();
 try{const run=await startProfileRead(username,key);await db().prepare("UPDATE recipient_lookups SET run_id=?,phase='reading' WHERE id=?").bind(run,id).run();}catch(e){await db().prepare("UPDATE recipient_lookups SET phase='failed' WHERE id=?").bind(id).run();throw e;}
 return {lookup:{id,phase:'reading',username},profile:null};
}
export async function recipientStatus(s:Session,input:unknown){
 const {id}=z.object({id:z.string().uuid()}).parse(input);await rateLimit(`recipient-poll:${s.wallet}`,30);
 const c=await db().prepare('SELECT * FROM recipient_lookups WHERE id=? AND session_hash=? AND wallet=?').bind(id,s.token_hash,s.wallet).first<Lookup>();if(!c)throw new AppError('Account lookup not found.',404);
 if(c.created_at<Date.now()-FRESH_MS)throw new AppError('Check this Instagram account again.',409);
 if(c.phase==='reading'&&c.run_id){try{
   const items=await readProfileResult(c.run_id,apiToken());if(items===null)return {lookup:{id,phase:'reading',username:c.username},profile:null};
   const p=parseProfile(items,c.username),now=Date.now();await db().batch([...recipientWrites(p,now).map(w=>db().prepare(w.sql).bind(...w.args)),db().prepare("UPDATE recipient_lookups SET phase='found' WHERE id=?").bind(id)]);c.phase='found';
 }catch(e){c.phase='failed';c.error=e instanceof AppError?e.message:'Could not check this account. Please try again.';await db().prepare("UPDATE recipient_lookups SET phase='failed',error=? WHERE id=?").bind(c.error,id).run();}}
 return {lookup:{id,phase:c.phase,username:c.username,error:c.error},profile:c.phase==='found'?await creator(c.username):null};
}
