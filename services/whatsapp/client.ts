/**
 * WhatsApp Cloud API client.
 * Sends outbound messages via the Graph API.
 */

const WA_API_VERSION = "v19.0";
const WA_BASE_URL    = `https://graph.facebook.com/${WA_API_VERSION}`;

/** WhatsApp Cloud API hard limit on text body length */
const WA_MAX_MESSAGE_LENGTH = 4096;

// ============================================================
// Send a plain text reply
// ============================================================

export async function sendWhatsAppMessage(
  to: string,
  text: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "Missing WhatsApp environment variables: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN"
    );
  }

  // Truncate to WA limit to prevent silent API failures
  const safeText = text.length > WA_MAX_MESSAGE_LENGTH
    ? text.slice(0, WA_MAX_MESSAGE_LENGTH - 3) + "..."
    : text;

  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: safeText,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `[WhatsApp] Failed to send message to ${to}: ${response.status} ${errorBody}`
    );
  }
}

// ============================================================
// Mark a message as read (improves UX — shows double blue tick)
// ============================================================

export async function markMessageAsRead(messageId: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) return;

  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  }).catch((err) => {
    // Non-critical — log but do not throw
    console.warn("[WhatsApp] Failed to mark message as read:", err);
  });
}
