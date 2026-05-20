import { Resend } from "resend";
import { sendWhatsAppMessage } from "@/services/whatsapp/client";
import { logger } from "@/lib/logger";

interface MaintenanceIssue {
  id: string;
  unit_name: string;
  issue_title: string;
  issue_description?: string | null;
  priority: string;
  impact_level?: string | null;
  category?: string | null;
  reported_by?: string | null;
  date_reported?: string | null;
  site_id?: string;
}

const NOTIFY_EMAIL = "burfix@gmail.com";
const NOTIFY_PHONE = "27729803451";

export async function sendMaintenanceEmail(
  issue: MaintenanceIssue,
  storeName?: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[MaintenanceNotify] RESEND_API_KEY not configured — skipping email");
    return false;
  }

  const resend = new Resend(apiKey);
  const venueName = process.env.VENUE_NAME ?? "Ops Engine";
  const fromAddress = process.env.SMTP_FROM ?? `${venueName} <onboarding@resend.dev>`;

  const priorityColor: Record<string, string> = {
    urgent: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#22c55e",
  };
  const color = priorityColor[issue.priority] ?? "#a8a29e";
  const store = storeName ?? "Unknown Store";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0a09;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#1c1917;border:1px solid #292524;border-radius:12px;padding:32px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
      <span style="font-size:20px;">🔧</span>
      <h2 style="color:#f5f5f4;margin:0;font-size:18px;">New Maintenance Issue</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;width:120px;">Store</td>
        <td style="padding:8px 12px;color:#f5f5f4;font-size:14px;">${store}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;">Equipment</td>
        <td style="padding:8px 12px;color:#f5f5f4;font-size:14px;">${issue.unit_name}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;">Issue</td>
        <td style="padding:8px 12px;color:#f5f5f4;font-size:14px;font-weight:600;">${issue.issue_title}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;">Priority</td>
        <td style="padding:8px 12px;">
          <span style="display:inline-block;background:${color}22;color:${color};border:1px solid ${color}44;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:700;text-transform:uppercase;">${issue.priority}</span>
        </td>
      </tr>
      ${issue.impact_level && issue.impact_level !== "none" ? `
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;">Impact</td>
        <td style="padding:8px 12px;color:#fbbf24;font-size:13px;">${issue.impact_level.replace(/_/g, " ")}</td>
      </tr>` : ""}
      ${issue.issue_description ? `
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;vertical-align:top;">Details</td>
        <td style="padding:8px 12px;color:#d6d3d1;font-size:13px;line-height:1.5;">${issue.issue_description}</td>
      </tr>` : ""}
      ${issue.reported_by ? `
      <tr>
        <td style="padding:8px 12px;color:#a8a29e;font-size:12px;font-weight:600;text-transform:uppercase;">Reported By</td>
        <td style="padding:8px 12px;color:#d6d3d1;font-size:13px;">${issue.reported_by}</td>
      </tr>` : ""}
    </table>
    <hr style="border:none;border-top:1px solid #292524;margin:20px 0 12px;">
    <p style="color:#57534e;font-size:11px;margin:0;">Sent by ${venueName} Maintenance Alerts</p>
  </div>
</body>
</html>`.trim();

  try {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: NOTIFY_EMAIL,
      subject: `🔧 [${issue.priority.toUpperCase()}] ${issue.issue_title} — ${store}`,
      html,
    });

    if (error) {
      logger.error("[MaintenanceNotify] Resend error", { err: error });
      return false;
    }

    logger.info("[MaintenanceNotify] Email sent", { to: NOTIFY_EMAIL, issueId: issue.id });
    return true;
  } catch (err) {
    logger.error("[MaintenanceNotify] Email failed", { err });
    return false;
  }
}

export async function sendMaintenanceWhatsApp(
  issue: MaintenanceIssue,
  storeName?: string,
): Promise<boolean> {
  try {
    const store = storeName ?? "Unknown Store";
    const lines = [
      `🔧 *New Maintenance Issue*`,
      ``,
      `*Store:* ${store}`,
      `*Equipment:* ${issue.unit_name}`,
      `*Issue:* ${issue.issue_title}`,
      `*Priority:* ${issue.priority.toUpperCase()}`,
    ];

    if (issue.impact_level && issue.impact_level !== "none") {
      lines.push(`*Impact:* ${issue.impact_level.replace(/_/g, " ")}`);
    }
    if (issue.issue_description) {
      lines.push(``, `_${issue.issue_description}_`);
    }
    if (issue.reported_by) {
      lines.push(``, `Reported by: ${issue.reported_by}`);
    }

    await sendWhatsAppMessage(NOTIFY_PHONE, lines.join("\n"));
    logger.info("[MaintenanceNotify] WhatsApp sent", { to: NOTIFY_PHONE, issueId: issue.id });
    return true;
  } catch (err) {
    logger.error("[MaintenanceNotify] WhatsApp failed", { err });
    return false;
  }
}
