import { WebClient } from "@slack/web-api";
import { ENV, FLAGS } from "../../config/env.js";

export const slack = new WebClient(ENV.SLACK_BOT_TOKEN);

export async function sendDm(userId: string, text: string, blocks?: any[]) {
  if (!FLAGS.slackEnabled) {
    console.log("[Slack DM]", text);
    return { ok: true, mock: true };
  }
  return slack.chat.postMessage({ channel: userId, text, blocks });
}

export async function sendOps(text: string, blocks?: any[]) {
  const channel = ENV.SLACK_OPS_CHANNEL_ID;
  if (!FLAGS.slackEnabled) {
    console.log("[Slack Ops]", text);
    return { ok: true, mock: true };
  }
  if (!channel) {
    console.warn("OPS:", text);
    return { ok: false, warning: 'SLACK_OPS_CHANNEL_ID not set' } as any;
  }
  return slack.chat.postMessage({ channel, text, blocks });
}

export async function sendToChannel(channelId: string, text: string, blocks?: any[]) {
  if (!FLAGS.slackEnabled) {
    console.log("[Slack Channel]", text);
    return { ok: true, mock: true };
  }
  return slack.chat.postMessage({ channel: channelId, text, blocks });
}
