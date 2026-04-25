import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { to, crn, title, status, term, restrictionsChanged } = await request.json();

    if (!to || !crn) {
      return NextResponse.json({ error: "Missing recipient or course" }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || "Cypress Scheduler <notifications@updates.cypressscheduler.app>";

    if (!apiKey) {
      return NextResponse.json({ ok: false, skipped: true, reason: "Missing RESEND_API_KEY" });
    }

    const subject = `Course Alert: ${title || crn} is now ${status}`;
    const html = `
      <h2>Cypress Scheduler Notification</h2>
      <p><strong>${title || crn}</strong> (${crn}) in <strong>${term || "your selected term"}</strong> changed status.</p>
      <ul>
        <li>Current Status: <strong>${status}</strong></li>
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
        to: [to],
        subject,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const text = await resendResponse.text();
      return NextResponse.json({ error: "Resend failed", details: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to send notification email", details: String(error) }, { status: 500 });
  }
}
