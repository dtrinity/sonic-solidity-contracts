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
 */
export async function sendSlackMessage(message: string): Promise<void> {
  try {
    const { client, channel } = await getSlackClient();
    await client.chat.postMessage({
      channel: channel as string,
      text: message,
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
}
