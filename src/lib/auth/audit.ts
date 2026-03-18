function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "redacted";
  if (local.length <= 2) return `**@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function logAuthEvent(
  event: string,
  details: {
    userId?: string;
    email?: string;
    provider?: string;
    success: boolean;
    reason?: string;
  }
): void {
  console.info("[auth]", {
    event,
    success: details.success,
    userId: details.userId,
    email: details.email ? maskEmail(details.email) : undefined,
    provider: details.provider,
    reason: details.reason,
  });
}
