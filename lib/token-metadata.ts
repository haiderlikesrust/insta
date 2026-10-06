import { AppError, hash } from './domain';
export type MetadataFields={name:string;symbol:string;description?:string;image?:string;website?:string;twitter?:string;telegram?:string;handle?:string;recipient_type?:string};
export function metadataDocument(token:MetadataFields, mint:string, appOrigin:string){
 const website=token.website||`${appOrigin}/token/${mint}`;
 return {name:token.name,symbol:token.symbol,description:token.description||'',image:new URL(token.image||'/brand-logo.png',appOrigin).href,external_url:website,extensions:{website,...(token.twitter?{twitter:token.twitter}:{}),...(token.telegram?{telegram:token.telegram}:{}),...(token.handle&&token.recipient_type!=='dev'?{instagram:`https://www.instagram.com/${token.handle}/`}:{})}};
}
export async function createMetadata(token:MetadataFields,mint:string,appOrigin:string){
 const {db}=await import('./server');
 if(!token.image)throw new AppError('Upload a coin image before launching.');
 if(token.image.startsWith('/api/media/')){const row=await db().prepare('SELECT id FROM media WHERE id=?').bind(token.image.split('/').pop()).first();if(!row)throw new AppError('Upload the coin image again.');}
 const document=metadataDocument(token,mint,appOrigin),data=JSON.stringify(document),id=await hash(data);
 await db().prepare('INSERT INTO metadata(id,data,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,data,Date.now()).run();
 return {uri:`${appOrigin}/api/metadata/${id}`,website:document.external_url};
}
