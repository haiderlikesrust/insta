import {notFound} from 'next/navigation';
import {PublicKey} from '@solana/web3.js';
import {db} from '@/lib/server';
import {TokenDetail,type PublicToken} from '@/components/token-detail';
export const dynamic='force-dynamic';
export default async function TokenPage({params}:{params:Promise<{address:string}>}){
 const {address}=await params;let mint:string;try{mint=new PublicKey(address).toBase58();}catch{notFound();}
 const token=await db().prepare("SELECT tokens.*,creators.claimed_at FROM tokens LEFT JOIN creators ON creators.id=tokens.creator_id WHERE tokens.mint=? AND tokens.status='launched'").bind(mint!).first<PublicToken>();
 if(!token)notFound();return <TokenDetail token={token}/>;
}
