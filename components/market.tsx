"use client";
import { useEffect, useState } from "react";
import { ExternalLink, X, TrendingUp } from "lucide-react";
type Price = { solUsd: number; asOf: number; stale: boolean; targets: { start: number; graduation: number; tokenStart: number } };
export const usd = (n: number, tiny = false) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: tiny ? 10 : 2, minimumFractionDigits: 2 }).format(n);
export function useUsdPrice() {
  const [price,setPrice]=useState<Price|null>(null);
  useEffect(()=>{let alive=true; const run=async()=>{try{const r=await fetch('/api/price');if(!r.ok)throw new Error();const d=await r.json() as {price:Price|null};if(alive)setPrice(d.price);}catch{if(alive)setPrice(p=>p?{...p,stale:true}:null);}};void run();const timer=setInterval(run,30000);return()=>{alive=false;clearInterval(timer);};},[]);
  return price;
}
export function CurveSummary() {
  const price=useUsdPrice();
  return <div className="curve-summary"><div><span>Starting market cap</span><strong>{price ? usd(price.targets.start) : "—"}<small> USD</small></strong></div><div><span>Graduation market cap</span><strong>{price ? usd(price.targets.graduation) : "—"}<small> USD</small></strong></div><div><span>Trading fee</span><strong>2%<small> fixed</small></strong></div><div className="rate-label"><TrendingUp size={15}/><span>{price ? `${price.stale ? "Stale reference" : "USD reference"} · ${new Date(price.asOf).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : "USD price feed unavailable"}<small>Valuations update with the underlying exchange rate.</small></span></div></div>;
}
export function MarketChart({ token, onClose }: { token: { id:string; mint:string; name:string; symbol:string }; onClose:()=>void }) {
  const [market,setMarket]=useState<{ priceUsd:number|null; marketCapUsd:number|null; graduated:boolean; stale:boolean }|null>(null);
  const [error,setError]=useState("");
  const [interval,setIntervalValue]=useState("15");
  useEffect(()=>{let alive=true; const run=async()=>{try {const r=await fetch(`/api/market/${token.id}`); const d=await r.json() as {market:typeof market;error?:string};if(!r.ok)throw new Error(d.error);if(alive){setMarket(d.market);setError("");}}catch{if(alive)setError("Live valuation unavailable. The external chart may still be available.");}};void run();const timer=setInterval(run,30000);return()=>{alive=false;clearInterval(timer);};},[token.id]);
  const url=`https://www.gmgn.cc/kline/sol/${encodeURIComponent(token.mint)}?theme=light&interval=${interval}`;
  return <section className="panel market-panel"><div className="panel-heading"><div><h2>{token.name}</h2><span className="locked-badge">${token.symbol}</span></div><button onClick={onClose} aria-label="Close chart"><X size={18}/></button></div><div className="market-stats"><div><span>Price · USD</span><strong>{market?.priceUsd != null ? usd(market.priceUsd,true) : "—"}</strong></div><div><span>Market cap · USD</span><strong>{market?.marketCapUsd != null ? usd(market.marketCapUsd) : "—"}</strong></div><div><span>Trading fee</span><strong>2%</strong></div><span className="locked-badge">{market?.graduated ? "Graduated · DAMM v2" : "Meteora DBC"}</span></div>{error&&<p className="chart-note">{error}</p>}{market?.stale&&<p className="chart-note">The USD conversion feed is stale. Values are indicative.</p>}<div className="chart-toolbar"><span>GMGN chart</span><div>{["1","5","15","60","1D"].map(v=><button key={v} className={interval===v?'chosen':''} onClick={()=>setIntervalValue(v)}>{v==='1D'?'1D':`${v}m`}</button>)}</div><a href={url} target="_blank" rel="noreferrer">Open chart <ExternalLink size={13}/></a></div><iframe key={url} title={`${token.name} live GMGN price chart`} src={url} sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" loading="lazy" /><p className="chart-note">GMGN controls chart units and token coverage. Fanfare’s valuations above are shown in USD; newly launched tokens may take time to appear.</p></section>;
}
