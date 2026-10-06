"use client";
import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,ExternalLink} from 'lucide-react';
import {pollConfirmation,type PendingTransaction,type ConfirmationResult} from '@/lib/confirmation-poll';
export function TransactionConfirmation({pending,onConfirmed}:{pending:PendingTransaction;onConfirmed:(result:ConfirmationResult)=>void}){
 const callback=useRef(onConfirmed);callback.current=onConfirmed;
 const [message,setMessage]=useState('Confirming on Solana automatically…'),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setError(false);setMessage('Confirming on Solana automatically…');
  void pollConfirmation(pending,controller.signal,setMessage).then(result=>{if(result&&!controller.signal.aborted)callback.current(result);}).catch(e=>{if(!controller.signal.aborted){setError(true);setMessage(e instanceof Error?e.message:'Unable to check confirmation.');}});
  return()=>controller.abort();
 },[pending.intentId,pending.signature,attempt]);
 return <div className={`notice ${error?'error':''}`} role={error?'alert':'status'}>{!error&&<LoaderCircle size={16} className="spin"/>}<span>{message}</span><a href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13}/></a>{error&&<button onClick={()=>setAttempt(v=>v+1)}>Retry confirmation</button>}</div>;
}
