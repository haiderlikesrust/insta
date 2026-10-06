// Launching a community coin does not depend on the platform token or buyback setup.
// Claims still require both, so the 10% deduction cannot bypass its buy-and-burn step.
export function deploymentReadiness(e:Record<string,string|undefined>,main=false){
 const blockers:string[]=[],instagram=!!(e.APIFY_API_TOKEN&&e.APP_ORIGIN);
 if(!main&&!instagram)blockers.push('Configure the Instagram profile reader.');
 if(!e.METEORA_CONFIG_KEY)blockers.push('Create the launch configuration in /admin.');
 if(!e.SOLANA_RPC_URL)blockers.push('Configure a Solana RPC endpoint.');
 if(!main&&!e.BACKEND_WALLET_SECRET_KEY)blockers.push('Configure the backend fee wallet.');
 if((main?e.MAIN_LAUNCH_ENABLED:e.LIVE_LAUNCHES_ENABLED)!=='true')blockers.push('Live transactions are not enabled.');
 const claimBlockers=[...blockers];
 if(!main&&!e.SOLANA_LOOKUP_TABLES)claimBlockers.push('Prepare creator claims in /admin.');
 if(!main&&!e.INSTARA_MINT)claimBlockers.push('Launch the INSTARA main token to enable buybacks and creator payouts.');
 return {live:!blockers.length,claimsLive:!claimBlockers.length,instagram,blockers,claimBlockers,network:e.SOLANA_NETWORK==='mainnet-beta'?'Solana mainnet':'Network not enabled'};
}
