const baseUrl = process.env.AI_TEST_BASE_URL || "http://127.0.0.1:3000";

async function main() {
  const res = await fetch(`${baseUrl}/api/ai-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "What model are you using right now?" }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`AI model test failed with HTTP ${res.status}`);
    console.error(body);
    process.exit(1);
  }

  const data = await res.json();
  const source = data?.source || "unknown";
  const model = data?.model || "unknown";

  console.log(`AI source: ${source}`);
  console.log(`AI model: ${model}`);
  console.log(`AI preview: ${(data?.reply || "").slice(0, 140)}`);
}

main().catch((error) => {
  console.error("AI model test crashed:", error);
  process.exit(1);
});
