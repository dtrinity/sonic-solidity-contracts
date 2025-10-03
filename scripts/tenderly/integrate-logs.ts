import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { traceTransaction } from "../../typescript/tenderly/client";

async function main() {
  const txHash = process.env.TENDERLY_TX_HASH ?? "0xd8ae4f2a66d059e73407eca6ba0ba5080f5003f5abbf29867345425276734a32";
  if (!process.env.TENDERLY_ACCESS_KEY) {
    throw new Error("TENDERLY_ACCESS_KEY must be set");
  }
  const trace = await traceTransaction({
    txHash,
    network: process.env.TENDERLY_NETWORK ?? "fraxtal",
    accessKey: process.env.TENDERLY_ACCESS_KEY,
    projectSlug: process.env.TENDERLY_PROJECT_SLUG ?? "project"
  });

  const outputDir = path.join("reports", "tenderly");
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, "raw-tenderly-trace.json");
  await fs.writeFile(outputFile, JSON.stringify(trace, null, 2));
  console.log(`Saved raw Tenderly trace to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
