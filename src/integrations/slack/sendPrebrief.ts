import { sendDm } from "./client.js";

export async function sendPrebrief(params: {
  userId: string;
  company: { name: string; industry?: string; location?: string; revenue?: string; ebitda?: string };
  questions: string[];
  briefUrl?: string;
}) {
  const { userId, company, questions, briefUrl } = params;
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `Pre-brief: ${company.name}` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Industry*\n${company.industry ?? "-"}` },
        { type: "mrkdwn", text: `*Location*\n${company.location ?? "-"}` },
        { type: "mrkdwn", text: `*Revenue*\n${company.revenue ?? "-"}` },
        { type: "mrkdwn", text: `*EBITDA*\n${company.ebitda ?? "-"}` },
      ],
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*Questions*\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` } },
    {
      type: "actions",
      elements: [
        briefUrl ? { type: "button", text: { type: "plain_text", text: "View Brief" }, url: briefUrl } : undefined,
      ].filter(Boolean) as any[],
    },
  ];
  await sendDm(userId, `Pre-brief for ${company.name}`, blocks);
}
