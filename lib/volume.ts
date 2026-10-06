type Volumes={volumes:Record<string,number|null>;asOf:number;unavailable:boolean};
let cached:Volumes|null=null,inFlight:Promise<Volumes>|null=null;
export function pairVolumes(pairs:unknown,mints:string[]){
 const result:Record<string,number|null>=Object.fromEntries(mints.map(m=>[m,null]));if(!Array.isArray(pairs))return result;
 const seen=new Set<string>();for(const p of pairs){if(p?.chainId!=='solana'||typeof p.pairAddress!=='string'||seen.has(p.pairAddress))continue;seen.add(p.pairAddress);const mint=p.baseToken?.address,v=p.volume?.h24;if(mint in result&&typeof v==='number'&&Number.isFinite(v)&&v>=0)result[mint]=(result[mint]??0)+v;}return result;
}
export async function coinVolumes(){
 if(cached&&Date.now()-cached.asOf<60000)return cached;if(inFlight)return inFlight;
 inFlight=(async()=>{const {db}=await import('./server');const rows=await db().prepare("SELECT mint FROM tokens WHERE status='launched'").all<{mint:string}>(),mints=rows.results.map(t=>t.mint);const result:Volumes={volumes:{},asOf:Date.now(),unavailable:false};
 for(let i=0;i<mints.length;i+=30){const chunk=mints.slice(i,i+30);try{const r=await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`,{signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error();Object.assign(result.volumes,pairVolumes(await r.json(),chunk));}catch{result.unavailable=true;Object.assign(result.volumes,Object.fromEntries(chunk.map(m=>[m,null])));}}
 cached=result;return result;})();try{return await inFlight;}finally{inFlight=null;}
}
