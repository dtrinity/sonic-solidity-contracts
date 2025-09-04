import { WebClient } from "@slack/web-api";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Cache the Slack client
let slackInfo: { client: WebClient; channel: string } | undefined;

/**
 * Get the Slack client
 *
 * @returns The Slack client and channel
 */
export async function getSlackClient(): Promise<{
  client: WebClient;
  channel: string;
}> {
  if (slackInfo) {
    return slackInfo;
  }

  const slackBotToken = process.env.SONIC_MAINNET_SLACK_BOT_TOKEN;
  const slackChannelId = process.env.SONIC_MAINNET_SLACK_CHANNEL_ID;

  if (!slackBotToken || !slackChannelId) {
    throw new Error(
      "SONIC_MAINNET_SLACK_BOT_TOKEN and SONIC_MAINNET_SLACK_CHANNEL_ID must be set in environment variables",
    );
  }

  const client = new WebClient(slackBotToken);
  return { client, channel: slackChannelId };
}

/**
 * Send a message to Slack
 *
 * @param message - The message to send
 * @param withIp - Whether to include the public IP address
 */
export async function sendSlackMessage(
  message: string,
  withIp: boolean = true,
): Promise<void> {
  try {
    let actualMessage = message;

    if (withIp) {
      const publicIp = await getPublicIPString();
      actualMessage = `Host IP: ${publicIp}\n\n${message}`;
    }

    const { client, channel } = await getSlackClient();
    await client.chat.postMessage({
      channel: channel as string,
      text: actualMessage,
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
}

/**
 * Get the public IP address
 *
 * @returns The public IP address
 */
async function getPublicIPString(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    const ip = data.ip;

    if (!ip) {
      return "got_empty_ip";
    }

    return ip;
  } catch (error) {
    console.log("Failed to get public IP:", error);
    return "failed_to_get_public_ip";
  }
}
