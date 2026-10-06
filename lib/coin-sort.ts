export type CoinSort='newest'|'oldest'|'volume';
export function sortCoins<T extends {id:string;created_at:number;launched_at?:number|null;mint:string|null}>(tokens:T[],sort:CoinSort,volumes:Record<string,number|null>={}){
 return [...tokens].sort((a,b)=>{const ageA=a.launched_at??a.created_at,ageB=b.launched_at??b.created_at;if(sort==='volume'){const av=volumes[a.mint||'']??-1,bv=volumes[b.mint||'']??-1;if(av!==bv)return bv-av;}return (sort==='oldest'?ageA-ageB:ageB-ageA)||a.id.localeCompare(b.id);});
}
