import {z} from 'zod';
export const devBuySchema=z.string().trim().default('0').transform(v=>v||'0').pipe(z.string().regex(/^(?:\d{1,6}(?:\.\d{0,9})?|\.\d{1,9})$/,'Enter a SOL amount with at most 9 decimal places.')).refine(v=>Number(v)<=100000,'Dev buy must be 100,000 SOL or less.');
export function solLamports(value:string|undefined){
 const [whole,fraction='']=devBuySchema.parse(value).split('.');
 return BigInt(whole||'0')*BigInt(1000000000)+BigInt(fraction.padEnd(9,'0'));
}
