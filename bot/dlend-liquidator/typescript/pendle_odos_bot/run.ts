import { printLog } from "../common/log";
import { runPTOdosBot } from "./core";

/**
 * The entry point for the PT+Odos liquidator bot
 */
async function main(): Promise<void> {
  let index = 1;

  while (true) {
    try {
      await runPTOdosBot(index);
    } catch (error: any) {
      // If error includes `No defined pools`, we can safely ignore it
      if (error.message.includes("No defined pools")) {
        printLog(index, `No defined pools for PT liquidation, skipping`);
      } else if (error.message.includes("Not a PT token")) {
        printLog(index, `No PT tokens found for liquidation, skipping`);
      } else {
        console.error("PT Liquidator Error:", error);
      }
    }

    console.log(``);
    // Wait for 5 seconds before running the bot again
    await new Promise((resolve) => setTimeout(resolve, 5000));
    index++;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 