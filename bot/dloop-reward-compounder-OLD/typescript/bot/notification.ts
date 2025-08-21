import { log } from "../utils/logger";

/**
 *
 * @param msg
 */
export async function notifySuccess(msg: string) {
  log.info("Slack success:", msg);
}

/**
 *
 * @param msg
 */
export async function notifyError(msg: string) {
  log.error("Slack error:", msg);
}
