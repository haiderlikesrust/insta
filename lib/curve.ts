import { buildCurveWithMarketCap, ActivationType, BaseFeeMode, CollectFeeMode, MigrationFeeOption, MigrationOption, TokenAuthorityOption, TokenDecimal, TokenType, MigratedCollectFeeMode, DammV2DynamicFeeMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
export { ECONOMICS, usdTargets } from "./economics";
import { ECONOMICS } from "./economics";
export function buildFanfareCurve() {
  return buildCurveWithMarketCap({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: TokenDecimal.NINE, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: ECONOMICS.supply, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 200, endingFeeBps: 200, numberOfPeriod: 0, totalDuration: 0 } }, dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 100, poolCreationFee: 0, enableFirstSwapWithMinFee: false },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 }, migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 200 } },
    liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 100 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp, initialMarketCap: 20, migrationMarketCap: 250,
  });
}
