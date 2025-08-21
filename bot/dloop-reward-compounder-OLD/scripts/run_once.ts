import { runOnce } from "../typescript/bot/runner";

runOnce().catch((e) => { console.error(e); process.exit(1); });

