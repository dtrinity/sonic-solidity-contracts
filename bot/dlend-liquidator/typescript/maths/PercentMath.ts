import { BigNumber } from "@ethersproject/bignumber/lib/bignumber";
import { BigNumberish, ethers } from "ethers";

// Reference: https://github.com/morpho-labs/ethers-utils/blob/1a235e4c2254014ab610d15991c7c1b0a9c66d20/src/maths/PercentMath.ts

const BASE_PERCENT = BigNumber.from(10_000);
const HALF_PERCENT = BASE_PERCENT.div(2);

export const pow10 = (power: BigNumberish): BigNumber =>
  BigNumber.from(10).pow(power);

const percentMul = (x: BigNumber, pct: BigNumber): BigNumber => {
  x = BigNumber.from(x);
  if (x.eq(0) || BigNumber.from(pct).eq(0)) return BigNumber.from(0);

  return x.mul(pct).add(HALF_PERCENT).div(BASE_PERCENT);
};

const percentDiv = (x: BigNumber, pct: BigNumber): BigNumber => {
  x = BigNumber.from(x);
  pct = BigNumber.from(pct);
  if (x.eq(0) || BigNumber.from(pct).eq(0)) return BigNumber.from(0);

  return x.mul(BASE_PERCENT).add(pct.div(2)).div(pct);
};

const weiToPercent = (weiNumber: BigNumber): BigNumber =>
  BigNumber.from(weiNumber)
    .mul(BASE_PERCENT)
    .div(pow10(14))
    .add(HALF_PERCENT)
    .div(BASE_PERCENT);

const percentDivUp = (x: BigNumber, pct: BigNumber): BigNumber => {
  x = BigNumber.from(x);
  pct = BigNumber.from(pct);
  return x.mul(BASE_PERCENT).add(pct.sub(1)).div(pct);
};

const parsePercent = (a: string, pow100: boolean = false): bigint =>
  ethers.parseUnits(a, pow100 ? 2 : 4);

const PercentMath = {
  BASE_PERCENT,
  HALF_PERCENT,
  percentMul,
  percentDiv,
  weiToPercent,
  percentDivUp,
  parsePercent,
};
export default PercentMath;
