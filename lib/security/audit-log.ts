type AuditLevel = "info" | "warn" | "error";

type AuditEvent = {
  event: string;
  level?: AuditLevel;
  userEmail?: string;
  ip?: string;
  details?: Record<string, unknown>;
};

export function writeAuditLog(payload: AuditEvent) {
  const entry = {
    ts: new Date().toISOString(),
    level: payload.level || "info",
    event: payload.event,
    userEmail: payload.userEmail || null,
    ip: payload.ip || null,
    details: payload.details || {},
  };

  // JSON logs are easy to ingest into managed logging providers.
  console.log(`[audit] ${JSON.stringify(entry)}`);
}
