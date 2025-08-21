import * as fs from "fs";

export type Env = {
  RPC_URL: string;
  PRIVATE_KEY: string;
  SLACK_WEBHOOK_URL?: string;
};

/**
 *
 */
export function loadEnv(): Env {
  if (fs.existsSync(".env")) {
    const data = fs.readFileSync(".env", "utf8");
    data.split(/\r?\n/).forEach((line) => {
      const [k, ...rest] = line.split("=");
      if (!k) return;
      const v = rest.join("=");
      if (!process.env[k] && v) process.env[k] = v;
    });
  }
  const RPC_URL = process.env.RPC_URL || "";
  const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  if (!RPC_URL || !PRIVATE_KEY)
    throw new Error("Missing RPC_URL or PRIVATE_KEY");
  return { RPC_URL, PRIVATE_KEY, SLACK_WEBHOOK_URL };
}
