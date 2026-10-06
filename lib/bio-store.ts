import { assertBioProof, type BioProfile } from './bio-proof';
type BoundChallenge={id:string;account_id:string|null;username:string;code:string;expires_at:number;phase:string;wallet:string;session_hash:string};
export function recipientWrites(p:BioProfile,now:number){return [
 {sql:"UPDATE creators SET username='former_'||id,verified_at=0,profile_at=0 WHERE username=? AND id!=?",args:[p.username,p.id]},
 {sql:"INSERT INTO creators(id,username,verified_at,profile_at,followers,biography,picture) VALUES(?,?,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,profile_at=excluded.profile_at,followers=excluded.followers,biography=excluded.biography,picture=excluded.picture",args:[p.id,p.username,now,p.followers,p.biography.replace(/FANFARE-[a-f0-9]{32}/g,'').trim(),p.picture]},
];}
export function verificationWrites(c:BoundChallenge,p:BioProfile,s:{wallet:string;token_hash:string},now:number){
 assertBioProof(c,p,s.wallet,s.token_hash,now);
 const active="EXISTS(SELECT 1 FROM bio_challenges WHERE id=? AND phase='checking' AND expires_at>?)";
 const clean={...p,biography:p.biography.replace(c.code,'').trim()};
 return [
  {sql:`UPDATE creators SET username='former_'||id,verified_at=0 WHERE username=? AND id!=? AND ${active}`,args:[p.username,p.id,c.id,now]},
  {sql:`INSERT INTO creators(id,username,verified_at,profile_at,claimed_at,followers,biography,picture) SELECT ?,?,?,?,?,?,?,? WHERE ${active} ON CONFLICT(id) DO UPDATE SET username=excluded.username,verified_at=excluded.verified_at,profile_at=excluded.profile_at,claimed_at=COALESCE(creators.claimed_at,excluded.claimed_at),followers=excluded.followers,biography=excluded.biography,picture=excluded.picture`,args:[p.id,p.username,now,now,now,p.followers,clean.biography,p.picture,c.id,now]},
  {sql:`UPDATE sessions SET creator_id=?,verified_at=? WHERE token_hash=? AND wallet=? AND expires_at>? AND ${active}`,args:[p.id,now,s.token_hash,s.wallet,now,c.id,now]},
  {sql:"UPDATE bio_challenges SET phase='verified',profile_json=?,error=NULL WHERE id=? AND phase='checking' AND expires_at>?",args:[JSON.stringify(clean),c.id,now]},
 ];
}
