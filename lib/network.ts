import {AppError} from './domain';
// getGenesisHash returns the full hash, not the truncated CAIP-2 chain ID.
export const MAINNET_GENESIS_HASH='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export async function assertMainnet(connection:{getGenesisHash():Promise<string>}){
 if(await connection.getGenesisHash()!==MAINNET_GENESIS_HASH)throw new AppError('The server RPC is not Solana mainnet. Set SOLANA_RPC_URL to a mainnet endpoint and redeploy.',503);
}
