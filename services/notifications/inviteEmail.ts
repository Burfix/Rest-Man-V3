import { Resend } from "resend";
import { logger } from "@/lib/logger";

interface InviteEmailParams {
  to: string;
  name?: string;
  role?: string;
  inviteLink: string;
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[InviteEmail] RESEND_API_KEY not configured — skipping email");
    return false;
  }

  const resend = new Resend(apiKey);
  const venueName = process.env.VENUE_NAME ?? "ForgeStack";
  const fromAddress = process.env.SMTP_FROM ?? `${venueName} <onboarding@resend.dev>`;
  const { to, name, role, inviteLink } = params;

  const greeting = name ? `Hi ${name},` : "Hi,";
  const roleText = role ? ` as <strong>${role.replace(/_/g, " ")}</strong>` : "";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0a09;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#1c1917;border:1px solid #292524;border-radius:12px;padding:32px;">
    <h2 style="color:#f5f5f4;margin:0 0 16px;font-size:20px;">${venueName}</h2>
    <p style="color:#d6d3d1;font-size:14px;line-height:1.6;margin:0 0 12px;">
      ${greeting}
    </p>
    <p style="color:#d6d3d1;font-size:14px;line-height:1.6;margin:0 0 24px;">
      You've been invited to join <strong style="color:#f5f5f4;">${venueName}</strong>${roleText}. Click the button below to set your password and get started.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${inviteLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;">
        Set Password &amp; Get Started
      </a>
    </div>
    <p style="color:#78716c;font-size:12px;line-height:1.5;margin:0 0 8px;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="color:#57534e;font-size:11px;word-break:break-all;margin:0 0 24px;">
      ${inviteLink}
    </p>
    <hr style="border:none;border-top:1px solid #292524;margin:0 0 16px;">
    <p style="color:#57534e;font-size:11px;margin:0;">
      This link expires in 24 hours. If you didn't expect this invite, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`.trim();

  try {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject: `You've been invited to ${venueName}`,
      html,
    });

    if (error) {
      logger.error("[InviteEmail] Resend error", { err: error, to });
      return false;
    }

    logger.info("[InviteEmail] Sent", { to });
    return true;
  } catch (err) {
    logger.error("[InviteEmail] Failed to send", { err, to });
    return false;
  }
}
