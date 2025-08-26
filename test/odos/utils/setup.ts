import { BigNumberish, Contract } from "ethers";
import { ethers } from "hardhat";

/**
 *
 * @param name
 * @param symbol
 * @param decimals
 */
export async function deployMintableERC20(
  name: string,
  symbol: string,
  decimals = 18,
): Promise<any> {
  const Token = await ethers.getContractFactory("TestMintableERC20");
  return Token.deploy(name, symbol, decimals);
}

/**
 *
 */
export async function deployMockRouter(): Promise<any> {
  const Router = await ethers.getContractFactory("MockOdosRouterV2");
  return Router.deploy();
}

/**
 *
 * @param token
 * @param to
 * @param amount
 */
export async function mint(token: Contract, to: string, amount: BigNumberish) {
  await (await token.mint(to, amount)).wait();
}
