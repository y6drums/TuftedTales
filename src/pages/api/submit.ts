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

  // Fire-and-forget waitlist welcome email to the joiner.
  if (formType === 'waitlist' && senderEmail && /.+@.+\..+/.test(senderEmail)) {
    const firstName = senderName.split(/\s+/)[0] || '';
    const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi!';

    const welcomeHtml = `<div style="font-family:'Mulish',system-ui,sans-serif;max-width:600px;margin:0 auto;background:#faf4ea;padding:36px 28px;border-radius:14px;color:#1d1d1d;">
        <div style="text-align:center;border-bottom:2px solid #b04725;padding-bottom:16px;margin-bottom:24px;">
          <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#b04725;font-weight:700;">Welcome</div>
          <div style="font-size:26px;color:#064946;font-weight:700;margin-top:6px;line-height:1.15;">You're on the list!</div>
        </div>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${greeting}</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Thanks for joining the Tufted Tales Studio Waitlist.</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">You're officially among the first to hear about our grand opening, workshop dates, private events, Tale Bears experiences, studio rentals, exclusive promotions, and special announcements.</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">We're excited to welcome you into the studio soon and can't wait to help you create something unforgettable.</p>
        <p style="margin:0 0 6px;font-size:15px;line-height:1.55;">See you soon!</p>
        <p style="margin:0;font-size:15px;line-height:1.55;font-weight:700;color:#064946;">The Tufted Tales Studio Team</p>
        <div style="margin-top:28px;padding-top:16px;border-top:1px solid rgba(29,29,29,0.12);font-size:12px;color:#6b6b62;text-align:center;">
          Tufted Tales Studio · 7613 Fortson Rd, Suite B, Columbus, GA · <a href="mailto:hello@tuftedtalesstudio.com" style="color:#b04725;text-decoration:none;">hello@tuftedtalesstudio.com</a>
        </div>
      </div>`;

    const welcomeText = `${firstName ? `Hi ${firstName},` : 'Hi!'}

Thanks for joining the Tufted Tales Studio Waitlist.

You're officially among the first to hear about our grand opening, workshop dates, private events, Tale Bears experiences, studio rentals, exclusive promotions, and special announcements.

We're excited to welcome you into the studio soon and can't wait to help you create something unforgettable.

See you soon!
The Tufted Tales Studio Team

Tufted Tales Studio · 7613 Fortson Rd, Suite B, Columbus, GA
hello@tuftedtalesstudio.com`;

    try {
      const { error: welcomeError } = await resend.emails.send({
        from,
        to: [senderEmail],
        replyTo: inbox,
        subject: 'Welcome to the Tufted Tales Studio VIP Waitlist!',
        html: welcomeHtml,
        text: welcomeText,
      });
      if (welcomeError) console.error('Waitlist welcome email failed:', welcomeError);
    } catch (err) {
      // Don't fail the request — inbox notification already succeeded.
      console.error('Waitlist welcome email threw:', err);
    }
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
