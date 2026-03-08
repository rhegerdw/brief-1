import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../src/integrations/supabase/client.js';

/**
 * Render a meeting brief as HTML
 *
 * GET /api/view/brief?meeting_id=<uuid>
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const meetingId = req.query.meeting_id as string;

  if (!meetingId) {
    return res.status(400).send('Missing meeting_id parameter');
  }

  // Fetch brief
  const { data: brief, error } = await supabaseAdmin
    .from('meetingbrief_results')
    .select('*')
    .eq('meeting_id', meetingId)
    .single();

  if (error || !brief) {
    return res.status(404).send('Brief not found');
  }

  // Fetch meeting and company info
  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('*, companies(*)')
    .eq('id', meetingId)
    .single();

  const company = meeting?.companies;
  const metrics = (brief.metrics || {}) as Record<string, unknown>;
  const questions = (metrics.questions || []) as string[];
  const sources = (brief.sources || []) as Array<{ url?: string; title?: string }>;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Brief: ${brief.attendee_name || 'Unknown'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #f8f9fa;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      color: white;
      padding: 24px 32px;
    }
    .header h1 {
      font-family: 'Lora', Georgia, serif;
      font-size: 28px;
      font-weight: 500;
      margin-bottom: 8px;
    }
    .header .subtitle {
      font-size: 14px;
      opacity: 0.9;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      padding: 20px 32px;
      background: #f8f9fa;
      border-bottom: 1px solid #e5e7eb;
    }
    .meta-item {
      font-size: 13px;
    }
    .meta-label {
      color: #6b7280;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .meta-value {
      font-weight: 500;
      color: #1a1a1a;
    }
    .content {
      padding: 32px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }
    .brief-content {
      font-family: 'Lora', Georgia, serif;
      font-size: 16px;
      line-height: 1.8;
    }
    .brief-content p { margin-bottom: 16px; }
    .brief-content ul { margin: 16px 0; padding-left: 24px; }
    .brief-content li { margin-bottom: 8px; }
    .questions {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: 20px;
    }
    .questions ol {
      padding-left: 24px;
    }
    .questions li {
      margin-bottom: 12px;
      color: #166534;
    }
    .sources {
      background: #fafafa;
      border-radius: 8px;
      padding: 16px;
    }
    .sources ul {
      list-style: none;
    }
    .sources li {
      margin-bottom: 8px;
    }
    .sources a {
      color: #2563eb;
      text-decoration: none;
      font-size: 14px;
    }
    .sources a:hover {
      text-decoration: underline;
    }
    .footer {
      padding: 20px 32px;
      background: #f8f9fa;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 600px) {
      body { padding: 12px; }
      .header { padding: 20px; }
      .content { padding: 20px; }
      .meta { padding: 16px 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${brief.attendee_name || 'Unknown Attendee'}</h1>
      <div class="subtitle">${brief.company_name || company?.name || 'Unknown Company'}</div>
    </div>

    <div class="meta">
      <div class="meta-item">
        <div class="meta-label">Email</div>
        <div class="meta-value">${brief.attendee_email || '-'}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Industry</div>
        <div class="meta-value">${company?.industry || metrics.industry_key || 'Other'}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Location</div>
        <div class="meta-value">${company?.location || company?.territory || '-'}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Meeting Time</div>
        <div class="meta-value">${meeting?.starts_at ? new Date(meeting.starts_at).toLocaleString() : '-'}</div>
      </div>
    </div>

    <div class="content">
      <div class="section">
        <h2 class="section-title">Research Brief</h2>
        <div class="brief-content">
          ${brief.brief_html || '<p>No brief content available.</p>'}
        </div>
      </div>

      ${questions.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Discovery Questions</h2>
        <div class="questions">
          <ol>
            ${questions.map(q => `<li>${q}</li>`).join('')}
          </ol>
        </div>
      </div>
      ` : ''}

      ${sources.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Sources</h2>
        <div class="sources">
          <ul>
            ${sources.map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title || s.url}</a></li>`).join('')}
          </ul>
        </div>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      Generated by Brief &bull; ${new Date(brief.created_at).toLocaleString()}
    </div>
  </div>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
