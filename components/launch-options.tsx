"use client";
import {useId,useState} from 'react';
import {Upload,LoaderCircle,ImagePlus} from 'lucide-react';
async function compress(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a PNG, JPEG, or WebP image under 10 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const ratio=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image processing is unavailable in this browser.');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',.9));if(!blob||blob.size>1024*1024)throw new Error('Try a smaller image.');return blob;
 }finally{bitmap.close();}
}
export function ImageUpload({value,onChange,connected,disabled,onBusy}:{value:string;onChange:(v:string)=>void;connected:boolean;disabled?:boolean;onBusy:(busy:boolean)=>void}){
 const id=useId(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function upload(file?:File){if(!file)return;setBusy(true);onBusy(true);setError('');try{const blob=await compress(file),r=await fetch('/api/media',{method:'POST',headers:{'Content-Type':blob.type},body:blob}),data=await r.json() as {image:string;error?:string};if(!r.ok)throw new Error(data.error||'Image upload failed.');onChange(data.image);}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}}
 return <div className="image-upload"><div className="form-label">Coin image <span>PNG, JPEG, WebP</span></div><label className={`upload-picker ${busy?'upload-busy':''}`} htmlFor={id}>{value?<img src={value} alt="Coin image preview"/>:<span className="upload-placeholder"><ImagePlus size={27}/></span>}<span><strong>{busy?'Uploading image…':value?'Change image':'Upload an image'}</strong><small>{connected?'Square images look best · up to 10 MB':'Connect your wallet to upload'}</small></span>{busy?<LoaderCircle size={20} className="spin"/>:<Upload size={20}/>}<input id={id} type="file" accept="image/png,image/jpeg,image/webp" disabled={!connected||disabled||busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>{error&&<p className="upload-error" role="alert">{error}</p>}</div>;
}
export type LaunchExtras={website:string;twitter:string;telegram:string;devBuySol:string};
export function LaunchOptions({value,onChange,disabled}:{value:LaunchExtras;onChange:(key:keyof LaunchExtras,value:string)=>void;disabled?:boolean}){
 return <fieldset className="launch-options" disabled={disabled}><details className="advanced"><summary>Social links <span>Optional</span></summary><label className="form-label">Website<input type="url" placeholder="Your Instara token page (automatic)" maxLength={200} value={value.website} onChange={e=>onChange('website',e.target.value)}/></label><p>Leave blank to use instara.xyz/token/your-token-address.</p><div className="two-fields"><label>X<input type="url" placeholder="https://x.com/…" maxLength={200} value={value.twitter} onChange={e=>onChange('twitter',e.target.value)}/></label><label>Telegram<input type="url" placeholder="https://t.me/…" maxLength={200} value={value.telegram} onChange={e=>onChange('telegram',e.target.value)}/></label></div></details><label className="form-label">Dev buy <span>Optional · SOL</span><div className="sol-input"><input type="text" inputMode="decimal" maxLength={16} placeholder="0.00" value={value.devBuySol} onChange={e=>onChange('devBuySol',e.target.value)}/><span>SOL</span></div></label><p className="field-hint">Leave at zero to skip. Your launching wallet buys and receives the tokens in the launch transaction. Enter the exact SOL amount, with 1% slippage protection. Network and account creation costs are extra.</p></fieldset>;
}
