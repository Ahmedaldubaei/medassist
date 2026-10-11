/**
 * Transactional email via the Resend HTTP API.
 *
 * Sends: Arabic welcome email + email-verification link on registration.
 * The sender defaults to Resend's sandbox (onboarding@resend.dev), which only
 * delivers to the Resend account owner's inbox — set RESEND_FROM to a verified
 * domain sender for production.
 * When RESEND_API_KEY is unset, sending is skipped with a warning and the
 * calling flow (registration) still succeeds.
 */
import { config } from '../config.js';

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!config.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — skipping "${subject}" to ${to}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

const dir = 'dir="rtl" lang="ar"';

export function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const subject = 'مرحبًا بك في مساعد التخدير الذكي';
  const html = `<div ${dir} style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2>مرحبًا ${escapeHtml(name)}،</h2>
    <p>تم إنشاء حسابك في <strong>مساعد التخدير الذكي</strong> بنجاح.</p>
    <p>يمكنك الآن طرح أسئلتك السريرية والحصول على إجابات موثقة بالمصادر، مع تنبيه دائم بأن المساعد مرجع معرفي وليس بديلًا عن طبيب التخدير.</p>
    <p style="color:#666;font-size:12px">هذه رسالة تلقائية — لا ترد عليها.</p>
  </div>`;
  return sendEmail(to, subject, html);
}

export function sendVerifyEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${config.APP_WEB_URL}/verify?token=${encodeURIComponent(token)}`;
  const subject = 'تحقق من بريدك الإلكتروني — مساعد التخدير الذكي';
  const html = `<div ${dir} style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2>مرحبًا ${escapeHtml(name)}،</h2>
    <p>شكرًا لتسجيلك في <strong>مساعد التخدير الذكي</strong>. اضغط الزر أدناه لتأكيد بريدك الإلكتروني:</p>
    <p><a href="${link}" style="display:inline-block;background:#0E7C7B;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">تأكيد البريد الإلكتروني</a></p>
    <p style="color:#666;font-size:12px">إذا لم يعمل الزر، انسخ الرابط التالي في المتصفح:<br>${escapeHtml(link)}</p>
    <p style="color:#666;font-size:12px">هذه رسالة تلقائية — لا ترد عليها.</p>
  </div>`;
  return sendEmail(to, subject, html);
}

export function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${config.APP_WEB_URL}/reset?token=${encodeURIComponent(token)}`;
  const subject = 'إعادة تعيين كلمة المرور — مساعد التخدير الذكي';
  const html = `<div ${dir} style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2>مرحبًا ${escapeHtml(name)}،</h2>
    <p>طلبت إعادة تعيين كلمة المرور لحسابك في <strong>مساعد التخدير الذكي</strong>. اضغط الزر أدناه لاختيار كلمة مرور جديدة:</p>
    <p><a href="${link}" style="display:inline-block;background:#0E7C7B;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">إعادة تعيين كلمة المرور</a></p>
    <p style="color:#666;font-size:12px">هذا الرابط يعمل مرة واحدة وينتهي خلال ساعة. إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>
    <p style="color:#666;font-size:12px">إذا لم يعمل الزر، انسخ الرابط التالي في المتصفح:<br>${escapeHtml(link)}</p>
    <p style="color:#666;font-size:12px">هذه رسالة تلقائية — لا ترد عليها.</p>
  </div>`;
  return sendEmail(to, subject, html);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
