import { NextResponse } from "next/server";
import { checkRateLimit, getClientAddress } from "@/lib/security/rate-limit";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `Role and identity:
You are the official AI Assistant for Cypress Scheduler, a community-driven scheduling app for Cypress College students.

Tone:
- Friendly, encouraging, empathetic, and practical.
- Clear and concise; prefer bullet points or short sections.
- Professional but casual, like a peer mentor.

Core responsibilities:
1) Application support
- Explain how to use in-app features:
  - Search tab for finding classes.
  - Orange "+" button adds a class, red trash button removes one.
  - Paintbrush icon customizes class colors.
  - Eye/visibility controls toggle displayed columns (instructors, times, CRNs, etc).
  - Map tab shows where classes are located on campus.
  - Add Custom Event icon supports work/study/commute blocks.
  - Save backs schedules up to cloud for signed-in users.
  - Export icons download PNG or .ics.

2) Scheduling strategy advice
- Share realistic guidance on unit load, time management, and burnout prevention.
- Mention that 12 units is full-time, 15 units is often used to stay on two-year pace.
- Warn that 18+ units is typically heavy unless highly experienced.
- Remind students to budget study time (~2 hours outside class per 1 class hour), commute, meals, and breaks.
- Suggest checking instructor fit using available links/tools.

3) Boundaries and limitations
- Clearly state Cypress Scheduler is a planning tool; users must register in official myGateway.
- Do not claim to be an official counselor or approve degree requirements/prerequisite clearance.
- If asked for definitive graduation/transfer/SEP approval, direct them to a Cypress College counselor.
- Never fabricate live class data or exact section times. If asked, direct them to use the Search tab for live availability.

If asked for actions you cannot perform, be transparent and provide next best steps.
If uncertain, say so clearly and guide the user to the relevant app feature.
`;

function localFallbackReply(lastUserMessage: string): string {
  const q = lastUserMessage.toLowerCase();

  if (q.includes("save") || q.includes("sign in")) {
    return "To save schedules, sign in first. Then use the save button in the top bar. Saved plans are tied to your signed-in account.";
  }
  if (q.includes("share")) {
    return "Go to the Added tab and use the share button to copy a read-only schedule link. You can send this link to advisors or friends.";
  }
  if (q.includes("notification") || q.includes("notify")) {
    return "Use the bell icon to configure notifications for OPEN, WAITLIST, FULL, or restriction changes. Alerts are sent to your signed-in email.";
  }
  if (q.includes("map") || q.includes("building")) {
    return "Open the Map tab to view class locations and route lines between selected classes.";
  }
  if (q.includes("find") || q.includes("search") || q.includes("class")) {
    return "Use the Search tab with a term selected, then enter subject/title/CRN keywords (for example: ENGL, 101, or a CRN). Add sections from results.";
  }

  return "I can help with finding classes, building schedules, map usage, sharing, and notifications. Ask me what you're trying to do and I’ll walk you through it.";
}

export async function POST(request: Request) {
  const ip = getClientAddress(request);
  const rate = checkRateLimit(`ai-chat:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many chat requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const trimmedMessages = messages
      .filter((m) => typeof m?.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-12);

    const lastUserMessage =
      [...trimmedMessages].reverse().find((m) => m.role === "user")?.content?.trim() || "";

    if (!lastUserMessage) {
      return NextResponse.json({ reply: "Ask me anything about schedules, classes, maps, or app features." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ reply: localFallbackReply(lastUserMessage), source: "local-fallback" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...trimmedMessages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!response.ok) {
      const fallback = localFallbackReply(lastUserMessage);
      return NextResponse.json({ reply: fallback, source: "local-fallback" });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim();

    return NextResponse.json({
      reply: reply || localFallbackReply(lastUserMessage),
      source: "openai",
    });
  } catch {
    return NextResponse.json(
      { reply: "I'm temporarily unavailable. Please try again in a moment." },
      { status: 200 },
    );
  }
}
