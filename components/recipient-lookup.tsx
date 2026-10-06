"use client";
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
type Creator={id:string;username:string;followers?:number|null;biography?:string|null;picture?:string|null;claimed_at?:number|null};
type Result={lookup:{id?:string;phase:string;username:string;error?:string|null};profile:Creator|null};
async function request(path:string,body:unknown){const r=await fetch(`/api/recipient/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json() as Result&{error?:string};if(!r.ok)throw new Error(d.error||'Could not check this account.');return d;}
export function RecipientLookup({username,wallet,onConnect,onFound}:{username:string;wallet:string;onConnect:()=>void;onFound:(profile:Creator)=>void}){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const callback=useRef(onFound);callback.current=onFound;
 const normalized=username.trim().replace(/^@/,'').toLowerCase(),current=result?.lookup.username===normalized?result:null;
 useEffect(()=>{setResult(null);setError('');},[normalized,wallet]);
 useEffect(()=>{if(!current?.lookup.id||!['starting','reading'].includes(current.lookup.phase))return;let alive=true;const id=current.lookup.id;const timer=setInterval(()=>{request('status',{id}).then(d=>{if(alive){setResult(d);if(d.profile)callback.current(d.profile);}}).catch(e=>{if(alive){setError(e.message);setResult(null);}});},5000);return()=>{alive=false;clearInterval(timer);};},[current?.lookup.id,current?.lookup.phase]);
 async function lookup(){if(!wallet)return onConnect();setBusy(true);setError('');try{const d=await request('start',{username:normalized});setResult(d);if(d.profile)callback.current(d.profile);}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 const pending=busy||!!current&&['starting','reading'].includes(current.lookup.phase);
 return <div className="recipient-lookup"><button type="button" className="secondary-button" onClick={lookup} disabled={!normalized||pending}>{pending?<LoaderCircle size={14} className="spin"/>:<Search size={14}/>} {pending?'Checking account…':'Check Instagram account'}</button>{(error||current?.lookup.error)&&<p className="bio-error" role="alert">{error||current?.lookup.error}</p>}{current?.profile&&<p className="field-hint">@{current.profile.username} exists{current.profile.followers!=null?` · ${current.profile.followers.toLocaleString()} followers`:''}. {current.profile.claimed_at?'Creator ownership verified.':'Fees stay locked until the creator verifies.'}</p>}</div>;
}
