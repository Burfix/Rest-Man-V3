export async function sendInviteEmail({
  email,
  name,
  inviteUrl,
}: {
  email: string
  name?: string
  inviteUrl: string
}) {
  // TODO: wire up to your email provider (Resend, SendGrid, etc.)
  console.log(`Invite email to ${email}: ${inviteUrl}`)
}
