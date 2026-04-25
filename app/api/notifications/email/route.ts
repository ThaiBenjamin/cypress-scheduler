import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkRateLimit, getClientAddress } from "@/lib/security/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { notificationPayloadSchema } from "@/lib/validation";

function escapeHtml(input?: string): string {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const sessionEmail = session?.user?.email;
    if (!sessionEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientAddress(request);
    const rate = checkRateLimit(`notifications:post:${sessionEmail}:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      writeAuditLog({
        event: "notifications.rate_limited",
        level: "warn",
        userEmail: sessionEmail,
        ip,
      });
      return NextResponse.json(
        { error: "Too many notification requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const rawPayload = await request.json();
    const parsed = notificationPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      writeAuditLog({
        event: "notifications.invalid_payload",
        level: "warn",
        userEmail: sessionEmail,
        ip,
      });
      return NextResponse.json({ error: "Invalid notification payload" }, { status: 400 });
    }

    const { to, crn, title, status, term, restrictionsChanged } = parsed.data;

    if (to && to.toLowerCase() !== sessionEmail.toLowerCase()) {
      writeAuditLog({
        event: "notifications.forbidden_recipient",
        level: "warn",
        userEmail: sessionEmail,
        ip,
        details: { attemptedRecipient: to },
      });
      return NextResponse.json({ error: "Recipient must match signed-in user" }, { status: 403 });
    }

    if (!crn) {
      return NextResponse.json({ error: "Missing course CRN" }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || "Cypress Scheduler <notifications@updates.cypressscheduler.app>";

    if (!apiKey) {
      return NextResponse.json({ ok: false, skipped: true, reason: "Missing RESEND_API_KEY" });
    }

    const safeTitle = escapeHtml(title || crn);
    const safeCrn = escapeHtml(crn);
    const safeTerm = escapeHtml(term || "your selected term");
    const safeStatus = escapeHtml(status || "updated");
    const subject = `Course Alert: ${title || crn} is now ${status || "UPDATED"}`;
    const html = `
      <h2>Cypress Scheduler Notification</h2>
      <p><strong>${safeTitle}</strong> (${safeCrn}) in <strong>${safeTerm}</strong> changed status.</p>
      <ul>
        <li>Current Status: <strong>${safeStatus}</strong></li>
        <li>Restrictions Changed: <strong>${restrictionsChanged ? "Yes" : "No"}</strong></li>
      </ul>
      <p>Open your scheduler to review and update your plan.</p>
    `;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [sessionEmail],
        subject,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const text = await resendResponse.text();
      writeAuditLog({
        event: "notifications.resend_error",
        level: "error",
        userEmail: sessionEmail,
        ip,
      });
      return NextResponse.json({ error: "Resend failed", details: text }, { status: 502 });
    }

    writeAuditLog({
      event: "notifications.sent",
      userEmail: sessionEmail,
      ip,
      details: { crn, term: term || null },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to send notification email", details: String(error) }, { status: 500 });
  }
}
