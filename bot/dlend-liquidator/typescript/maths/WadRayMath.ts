import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { ethers } from "ethers";

const WAD = BigNumber.from(10).pow(18);
const halfWAD = WAD.div(2);
const RAY = BigNumber.from(10).pow(27);
const halfRAY = RAY.div(2);
const WAD_RAY_RATIO = BigNumber.from(10).pow(9);

// Reference: https://github.com/morpho-labs/ethers-utils/blob/1a235e4c2254014ab610d15991c7c1b0a9c66d20/src/maths/WadRayMath.ts
export const WadRayMath = {
  WAD,
  halfWAD,
  RAY,
  halfRAY,
  wadMul: (a: BigNumberish, b: BigNumberish): BigNumber => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    if (a.eq(0) || b.eq(0)) return BigNumber.from(0);
    return halfWAD.add(a.mul(b)).div(WAD);
  },
  wadDiv: (a: BigNumberish, b: BigNumberish): BigNumber => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    return a.mul(WAD).add(b.div(2)).div(b);
  },

  rayMul: (a: BigNumberish, b: BigNumberish): BigNumber => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    if (a.eq(0) || b.eq(0)) return BigNumber.from(0);
    return halfRAY.add(a.mul(b)).div(RAY);
  },
  rayDiv: (a: BigNumberish, b: BigNumberish): BigNumber => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    return a.mul(RAY).add(b.div(2)).div(b);
  },
  rayToWad: (a: BigNumberish): BigNumber =>
    BigNumber.from(a).div(WAD_RAY_RATIO),
  wadToRay: (a: BigNumberish): BigNumber =>
    BigNumber.from(a).mul(WAD_RAY_RATIO),
  formatRay: (a: BigNumberish): string => ethers.formatUnits(a.toString(), 27),
  parseRay: (a: string): bigint => ethers.parseUnits(a, 27),
  parseWad: (a: string): bigint => ethers.parseUnits(a),
  formatWad: (a: string): string => ethers.formatUnits(a),
  wadDivUp: (a: BigNumberish, b: BigNumberish): BigNumber => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    return a.mul(WAD).add(b.sub(1)).div(b);
  },
  rayDivUp: (a: BigNumberish, b: BigNumberish): BigNumber => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    return a.mul(RAY).add(b.sub(1)).div(b);
  },
};

export default WadRayMath;
