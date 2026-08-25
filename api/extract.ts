import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

// Vercel serverless function — API key stays server-side, never exposed to browser
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body: any;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { base64, systemPrompt, role, userText } = body;
  if (!base64 || !systemPrompt) {
    res.status(400).json({ error: "Missing required fields: base64, systemPrompt" });
    return;
  }

  if (base64.length > 20_000_000) {
    res.status(413).json({ error: "File too large — max ~15MB PDF supported" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in environment variables" });
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const resolvedUserText = userText ?? (
    role === "accounts"
      ? "This PDF may contain Bills of Lading, Tax Invoices/Freight Invoices, AND Customs Permits or Outward Permits. STEP 1: Scan EVERY page. STEP 2: For each Tax Invoice or Freight Invoice page found (carrier letterhead, charge table, Amount Due), output one 'Payment Voucher/GL' entry with that invoice number. STEP 3: For each BL page, output one 'Bill of Lading' entry. STEP 4: Completely ignore Customs Permit / Outward Permit pages. A single PDF with 1 BL + 1 Tax Invoice must produce 2 entries. Do NOT combine invoice numbers. Do NOT sum amounts. Return valid JSON only. No explanation, no markdown."
      : role === "logistics"
      ? "Scan EVERY page and extract EVERY logistics document present, following the detailed field rules in the system prompt. Do NOT require a 'SHIPPING INSTRUCTION' header, and NEVER return an empty documents array just because there are no Shipping Instructions. Use exactly these three types: (1) 'Logistics Local Charges Report' — one entry for each carrier/forwarder Tax Invoice, Freight Invoice or Debit Note (a charge table with THC / seal / BL fee / etc.); read the PSS invoice number from the RED 'INVOICE NO.:' annotation on the Bill of Lading. (2) 'Outward Permit Declaration' — one entry for EACH of: (a) any Singapore Customs Cargo Clearance Permit / Outward Permit in the file, AND (b) any Shipping Instruction (a page with a 'SHIPPING INSTRUCTION' header plus a 'FOR SHIPPING DEPARTMENT ONLY' section — take container_no/seal_no from that section). If neither is present, simply produce no OPD entry — but still extract the other types. (3) 'Export Permit Declaration (PSS)' — for a PSS shipment bundle (Purchase Order + Commercial Invoice + Packing List) or a standalone proforma invoice / delivery note, one entry with export_permit_pss.items (one item per line). A file with 1 carrier invoice + 1 customs permit MUST produce 2 entries (one Logistics Local Charges Report + one Outward Permit Declaration). CRITICAL: use document_type (not type). Return ONLY {\"documents\": [...]}. No explanation, no markdown."
      : "Extract all documents from this PDF and return valid JSON only. No explanation, no markdown — just the JSON object."
  );

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Stream the response so the connection stays alive during long Claude calls.
      // This prevents proxy/CDN idle-timeout on large PSS bundles.
      let fullText = "";
      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 32000,
        temperature: 0,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              { type: "text", text: resolvedUserText },
            ],
          },
        ],
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullText += event.delta.text;
        }
      }

      if (!fullText) throw new Error("No data returned from Claude");

      res.status(200).json({ text: fullText });
      return;
    } catch (error: any) {
      if (attempt === maxRetries) {
        res.status(500).json({ error: error.message || "Extraction failed" });
        return;
      }
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
}
