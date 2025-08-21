import { log } from "../utils/logger";
import { getProvider, getSigner } from "../utils/provider";
import { getAddresses } from "./config";
import { notifyError, notifySuccess } from "./notification";
import { getPeriphery } from "./periphery";
import { buildSwapCalldata } from "./quoting";

/**
 *
 */
export async function runOnce() {
  const network = process.env.NETWORK || "sonic_testnet";
  const rpc = process.env.RPC_URL || "";
  const pk = process.env.PRIVATE_KEY || "";
  const addrs = getAddresses(network);
  const provider = getProvider(rpc);
  const signer = getSigner(pk, rpc);

  const flashAmount = 295n * 10n ** 18n;
  const slippageBps = Number(process.env.SLIPPAGE_BPS || 50);
  const { calldata } = await buildSwapCalldata(
    provider,
    addrs.CORE,
    slippageBps,
    flashAmount,
  );
  const periphery = getPeriphery(
    (addrs as any).RewardCompounderDLendOdos ||
      "0x0000000000000000000000000000000000000000",
    signer,
  );

  try {
    const tx = await periphery.run(calldata, flashAmount, slippageBps);
    log.info("submitted", tx.hash);
    const rcpt = await tx.wait();
    await notifySuccess(`Compound success: ${rcpt?.hash}`);
  } catch (e: any) {
    await notifyError(`Compound failed: ${e?.message || e}`);
  }
}
