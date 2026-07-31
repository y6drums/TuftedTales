import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const prerender = false;

const FORM_LABELS: Record<string, string> = {
  contact: 'Contact form',
  waitlist: 'Waitlist signup',
  'custom-rugs': 'Custom rug inquiry',
  'private-events': 'Private event inquiry',
};

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file (Resend caps at ~40 MB per email)
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fieldToRow(label: string, value: string): string {
  const safeLabel = escapeHtml(label);
  const safeValue = escapeHtml(value).replace(/\n/g, '<br />');
  return `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:#696d45;font-weight:600;">${safeLabel}</td><td style="padding:6px 0;color:#1d1d1d;">${safeValue}</td></tr>`;
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const inbox = import.meta.env.INBOX_EMAIL || 'hello@tuftedtalesstudio.com';
  const from = import.meta.env.FROM_EMAIL || 'Tufted Tales Studio <onboarding@resend.dev>';

  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Email service not configured.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid form submission.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Honeypot — silently succeed to waste spammer time.
  if ((form.get('bot-field') as string | null)?.trim()) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const formType = String(form.get('form-name') || form.get('form-type') || 'contact').trim();
  const formLabel = FORM_LABELS[formType] || 'Website form';

  const senderName = String(form.get('name') || '').trim();
  const senderEmail = String(form.get('email') || '').trim();

  // Collect visible fields and any file attachments.
  const rows: string[] = [];
  const attachments: { filename: string; content: string }[] = [];
  let totalAttachmentBytes = 0;
  const skippedFiles: string[] = [];

  const seen = new Set<string>();
  for (const [key, value] of form.entries()) {
    if (key === 'bot-field' || key === 'form-name' || key === 'form-type') continue;

    if (value instanceof File) {
      if (!value.size) continue;
      if (value.size > MAX_ATTACHMENT_BYTES || totalAttachmentBytes + value.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        skippedFiles.push(`${value.name} (${Math.round(value.size / 1024)} KB)`);
        continue;
      }
      const buf = Buffer.from(await value.arrayBuffer());
      attachments.push({ filename: value.name || `${key}.bin`, content: buf.toString('base64') });
      totalAttachmentBytes += value.size;
      rows.push(fieldToRow(key, `📎 ${value.name} (${Math.round(value.size / 1024)} KB)`));
      continue;
    }

    const str = String(value ?? '').trim();
    if (!str) continue;

    // Collapse checkbox groups with the same name into a comma list.
    if (seen.has(key)) {
      // rewrite the last row for this key
      const idx = rows.map((r, i) => ({ r, i })).reverse().find(({ r }) => r.includes(`>${escapeHtml(key)}<`))?.i;
      if (idx !== undefined) {
        const existing = form.getAll(key).map((v) => String(v)).filter(Boolean).join(', ');
        rows[idx] = fieldToRow(key, existing);
      }
      continue;
    }
    seen.add(key);
    rows.push(fieldToRow(key, str));
  }

  if (skippedFiles.length) {
    rows.push(fieldToRow('skipped-files (too large)', skippedFiles.join(', ')));
  }

  const subjectName = senderName || senderEmail || 'someone';
  const subject = `[${formLabel}] ${subjectName}`;

  const html = `<div style="font-family:'Mulish',system-ui,sans-serif;max-width:640px;margin:0 auto;background:#faf4ea;padding:32px;border-radius:14px;">
      <div style="border-bottom:2px solid #b04725;padding-bottom:12px;margin-bottom:20px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#b04725;font-weight:700;">${escapeHtml(formLabel)}</div>
        <div style="font-size:20px;color:#064946;font-weight:700;margin-top:4px;">New submission from tuftedtalesstudio.com</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows.join('')}</table>
    </div>`;

  const text = rows
    .map((r) => r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from,
      to: [inbox],
      replyTo: senderEmail || undefined,
      subject,
      html,
      text: `${formLabel} — new submission\n\n${text}`,
      attachments: attachments.length ? attachments : undefined,
    });

    if (error) {
      console.error('Resend error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: 'Could not send message. Please email hello@tuftedtalesstudio.com directly.' }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
  } catch (err) {
    console.error('Resend threw:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Could not send message. Please email hello@tuftedtalesstudio.com directly.' }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'POST only.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
