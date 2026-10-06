import { imageSize } from 'image-size';
import { AppError, hash } from './domain';
import { db, clientIp, type Session } from './server';
export const MAX_IMAGE_BYTES = 1024 * 1024;
export function validateImage(bytes: Uint8Array) {
 if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new AppError('The uploaded image must be 1 MB or smaller.', 413);
 try {
  const result = imageSize(bytes);
  if (!['png','jpg','webp'].includes(result.type || '') || !result.width || !result.height || result.width > 4096 || result.height > 4096) throw new Error();
  return result.type === 'jpg' ? 'image/jpeg' : `image/${result.type}`;
 } catch { throw new AppError('Use a PNG, JPEG, or WebP image up to 4096 pixels per side.'); }
}
async function dailyQuota(key: string, max: number) {
 const day = Math.floor(Date.now() / 86400000);
 const result = await db().prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count').bind(`upload:${key}:${day}`, (day+2)*86400000).first<{count:number}>();
 if (!result || result.count > max) throw new AppError('Image upload limit reached. Try again tomorrow.', 429);
}
export async function uploadImage(req: Request, s: Session) {
 await dailyQuota(s.wallet, 20); await dailyQuota(clientIp(req), 50); await dailyQuota('global', 500);
 if (!req.headers.get('content-type')?.startsWith('image/')) throw new AppError('Send an image file.', 415);
 const reader=req.body?.getReader(); if (!reader) throw new AppError('Choose an image.');
 const chunks:Uint8Array[]=[]; let length=0;
 for (;;) { const {value,done}=await reader.read(); if(done)break; length+=value.length; if(length>MAX_IMAGE_BYTES){await reader.cancel();throw new AppError('Image exceeds 1 MB.',413);}chunks.push(value); }
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const type=validateImage(bytes), id=await hash(bytes);
 await db().prepare('INSERT INTO media(id,content_type,data,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,type,Buffer.from(bytes).toString('base64'),Date.now()).run();
 return {image:`/api/media/${id}`};
}
export async function readAsset(kind: 'media'|'metadata', id: string) {
 if(!/^[a-f0-9]{64}$/.test(id))throw new AppError('Not found.',404);
 const row=await db().prepare(kind==='media'?'SELECT content_type,data FROM media WHERE id=?':'SELECT data FROM metadata WHERE id=?').bind(id).first<{content_type?:string;data:string}>();
 if(!row)throw new AppError('Not found.',404);
 return new Response(kind==='media'?new Uint8Array(Buffer.from(row.data,'base64')):row.data,{headers:{'Content-Type':row.content_type||'application/json; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
}
