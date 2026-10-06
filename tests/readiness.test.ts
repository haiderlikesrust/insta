import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentReadiness} from '../lib/readiness';
const base={APP_ORIGIN:'https://instara.xyz',APIFY_API_TOKEN:'test',METEORA_CONFIG_KEY:'test',SOLANA_RPC_URL:'https://rpc.example.com',BACKEND_WALLET_SECRET_KEY:'test',LIVE_LAUNCHES_ENABLED:'true',SOLANA_NETWORK:'mainnet-beta'};
test('community launches work before INSTARA and the claim lookup table exist',()=>{
 const status=deploymentReadiness(base);assert.equal(status.live,true);assert.deepEqual(status.blockers,[]);assert.equal(status.claimsLive,false);assert.equal(status.claimBlockers.length,2);
});
test('creator claims require both buyback dependencies without blocking launches',()=>{
 for(const extra of [{INSTARA_MINT:'mint'},{SOLANA_LOOKUP_TABLES:'table'}]){const status=deploymentReadiness({...base,...extra});assert.equal(status.live,true);assert.equal(status.claimsLive,false);}
 assert.equal(deploymentReadiness({...base,INSTARA_MINT:'mint',SOLANA_LOOKUP_TABLES:'table'}).claimsLive,true);
});
test('launch configuration, custody and integration requirements remain enforced',()=>{
 for(const key of ['APP_ORIGIN','APIFY_API_TOKEN','METEORA_CONFIG_KEY','SOLANA_RPC_URL','BACKEND_WALLET_SECRET_KEY','LIVE_LAUNCHES_ENABLED']){
  const status=deploymentReadiness({...base,[key]:undefined,INSTARA_MINT:'mint',SOLANA_LOOKUP_TABLES:'table'});assert.equal(status.live,false,key);assert.equal(status.claimsLive,false,key);
 }
});
test('the admin launch remains independent of Instagram, custody and community enablement',()=>{
 assert.equal(deploymentReadiness({METEORA_CONFIG_KEY:'test',SOLANA_RPC_URL:'https://rpc.example.com',MAIN_LAUNCH_ENABLED:'true'},true).live,true);
 assert.equal(deploymentReadiness({...base,MAIN_LAUNCH_ENABLED:'false'},true).live,false);
});
