export const API3_PRICE_DECIMALS = 18;
export const API3_BASE_CURRENCY_UNIT = 10n ** BigInt(API3_PRICE_DECIMALS);
export const API3_HEARTBEAT_SECONDS = 24 * 60 * 60;
export const API3_HEARTBEAT_HEALTH_BUFFER_SECONDS = 30 * 60;

export const ORACLE_AGGREGATOR_PRICE_DECIMALS = 18; // Using 18 to be consistent with the API3 price decimals and most common token decimals
export const ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT = 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS);
