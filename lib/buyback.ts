import {Connection, PublicKey, TransactionInstruction} from '@solana/web3.js';
import {getMint, getAssociatedTokenAddressSync} from '@solana/spl-token';
import {DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID as DBC, deriveDbcPoolAddress, deriveDbcPoolAuthority, deriveDbcEventAuthority, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {CpAmm, CP_AMM_PROGRAM_ID as DAMM, derivePoolAuthority} from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import {AppError} from './domain';
import {NATIVE_MINT,TOKEN_PROGRAM,discriminator} from './escrow';
export function splitClaim(gross:bigint){
 if(gross<BigInt(10000) || gross>BigInt("18446744073709551615"))throw new AppError('Too few fees to claim. Let more fees accumulate.');
 const buyback=gross/BigInt(10);return {gross,buyback,creator:gross-buyback};
}
export function slippageBps(value:string|undefined){const n=Number(value??100);if(!Number.isInteger(n)||n<1||n>300)throw new AppError('Buyback slippage must be between 1 and 300 bps.',503);return n;}
export async function buybackRoute(connection:Connection, e:Record<string,string|undefined>, vault:PublicKey, amount:bigint){
 if(!e.INSTARA_MINT)throw new AppError('INSTARA buybacks are unavailable.',503);
 const mint=new PublicKey(e.INSTARA_MINT),mintInfo=await getMint(connection,mint,'confirmed',TOKEN_PROGRAM),slippage=slippageBps(e.BUYBACK_SLIPPAGE_BPS);
 if(mint.equals(NATIVE_MINT))throw new AppError('Invalid INSTARA mint.',503);
 const client=new DynamicBondingCurveClient(connection,'confirmed');
 let poolKey=e.INSTARA_BUYBACK_POOL ? new PublicKey(e.INSTARA_BUYBACK_POOL) : deriveDbcPoolAddress(NATIVE_MINT,mint,new PublicKey(e.METEORA_CONFIG_KEY!));
 let owner=(await connection.getAccountInfo(poolKey))?.owner;
 let dbc=owner?.equals(DBC)?await client.state.getPool(poolKey):null;
 if(dbc?.poolState.isMigrated){const cfg=await client.state.getPoolConfig(dbc.poolState.config);if(!cfg)throw new AppError('Missing INSTARA curve configuration.',503);poolKey=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[cfg.migrationFeeOption],mint,NATIVE_MINT);owner=DAMM;dbc=null;}
 const m=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
 const input=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true),output=getAssociatedTokenAddressSync(mint,vault,true),inAmount=new BN(amount.toString());
 const slot=await connection.getSlot('confirmed'),time=await connection.getBlockTime(slot);
 if(time===null)throw new AppError('Unable to quote the INSTARA buyback.',503);
 let minimum:BN,keys:ReturnType<typeof m>[],program:PublicKey;
 if(dbc){
  const p=dbc.poolState,cfg=await client.state.getPoolConfig(p.config);
  if(!cfg||!p.baseMint.equals(mint)||!cfg.quoteMint.equals(NATIVE_MINT)||p.poolType!==0)throw new AppError('INSTARA buyback requires an SPL-token SOL pool.',503);
  const q=client.pool.swapQuote({virtualPool:dbc,config:cfg,swapBaseForQuote:false,amountIn:inAmount,slippageBps:slippage,hasReferral:false,eligibleForFirstSwapWithMinFee:false,currentPoint:new BN(cfg.activationType===0?slot:time)});
  minimum=q.minimumAmountOut;program=DBC;
  keys=[m(deriveDbcPoolAuthority()),m(p.config),m(poolKey,true),m(input,true),m(output,true),m(p.baseVault,true),m(p.quoteVault,true),m(mint),m(NATIVE_MINT),m(vault,false,true),m(TOKEN_PROGRAM),m(TOKEN_PROGRAM),m(DBC),m(deriveDbcEventAuthority()),m(DBC)];
 }else if(owner?.equals(DAMM)){
  const amm=new CpAmm(connection),p=await amm.fetchPoolState(poolKey);
  if(!p.tokenAMint.equals(mint)||!p.tokenBMint.equals(NATIVE_MINT)||p.tokenAFlag!==0||p.tokenBFlag!==0)throw new AppError('INSTARA buyback pool must contain INSTARA / SOL using SPL Token.',503);
  const q=amm.getQuote({inAmount,inputTokenMint:NATIVE_MINT,slippage:slippage/100,poolState:p,currentTime:time,currentSlot:slot,tokenADecimal:mintInfo.decimals,tokenBDecimal:9,hasReferral:false});
  if(!q.consumedInAmount.eq(inAmount))throw new AppError('Insufficient INSTARA liquidity for a full buyback.',409);
  minimum=q.minSwapOutAmount;program=DAMM;
  keys=[m(derivePoolAuthority()),m(poolKey,true),m(input,true),m(output,true),m(p.tokenAVault,true),m(p.tokenBVault,true),m(mint),m(NATIVE_MINT),m(vault,false,true),m(TOKEN_PROGRAM),m(TOKEN_PROGRAM),m(DAMM),m(PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],DAMM)[0]),m(DAMM)];
 }else throw new AppError('No supported INSTARA buyback pool is available.',503);
 if(minimum.lten(0))throw new AppError('Too few fees for a buyback. Let more fees accumulate.',409);
 const data=Buffer.alloc(24);discriminator('swap').copy(data);data.writeBigUInt64LE(amount,8);data.writeBigUInt64LE(BigInt(minimum.toString()),16);
 return {mint,minimum:BigInt(minimum.toString()),slippage,inner:new TransactionInstruction({programId:program,keys,data})};
}
