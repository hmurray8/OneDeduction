// Receives the OneDeduction lead-capture form submission, validates it,
// stores it in Postgres, and emails a notification via Resend.
//
// Deploy with JWT verification OFF for this function (it's a public
// marketing form, not an authenticated API) — see supabase/config.toml.
//
// Required secrets (set with `supabase secrets set`):
//   RESEND_API_KEY     - Resend API key
//   LEAD_NOTIFY_EMAIL   - inbox that should receive new-lead alerts
//   ALLOWED_ORIGIN      - e.g. https://onededuction.com (no trailing slash)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the Supabase runtime — do not set them yourself.

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://onededuction.com";

const INCOME_SOURCES = new Set(["payg", "sole-trader", "rental-property", "shares-investments", "crypto", "other"]);
const INCOME_BRACKETS = new Set(["under-40k", "40-80k", "80-150k", "150k-plus"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Honeypot: real users never see or fill this field. Bots that fill
  // every input do. Pretend success so bots don't learn to skip it.
  if (clean(body.website) !== "") {
    return json(200, { ok: true });
  }

  const lead = {
    first_name: clean(body.firstName, 100),
    last_name: clean(body.lastName, 100),
    email: clean(body.email, 200).toLowerCase(),
    phone: clean(body.phone, 30),
    income_bracket: clean(body.incomeBracket, 30),
    state: clean(body.state, 50),
    financial_year: clean(body.financialYear, 30),
  };

  const missing = Object.entries(lead)
    .filter(([, v]) => v === "")
    .map(([k]) => k);
  if (missing.length > 0) {
    return json(400, { error: `Missing required fields: ${missing.join(", ")}` });
  }
  if (!EMAIL_RE.test(lead.email)) {
    return json(400, { error: "Invalid email address" });
  }

  const incomeSources = Array.isArray(body.incomeSources)
    ? [...new Set(body.incomeSources.map((v) => clean(v, 30)))].filter((v) => v !== "")
    : [];
  if (incomeSources.length === 0) {
    return json(400, { error: "Select at least one income source" });
  }
  if (!incomeSources.every((v) => INCOME_SOURCES.has(v))) {
    return json(400, { error: "Invalid income source" });
  }

  if (!INCOME_BRACKETS.has(lead.income_bracket)) {
    return json(400, { error: "Invalid income bracket" });
  }
  if (clean(body.consent) !== "true") {
    return json(400, { error: "Consent is required" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error: insertError } = await supabase.from("leads").insert({ ...lead, income_sources: incomeSources });
  if (insertError) {
    console.error("insert failed", insertError);
    return json(500, { error: "Could not save your details. Please try again." });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const notifyEmail = Deno.env.get("LEAD_NOTIFY_EMAIL");
  if (resendKey && notifyEmail) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "OneDeduction Leads <leads@onededuction.com>",
          to: notifyEmail,
          subject: `New lead: ${lead.first_name} ${lead.last_name}`,
          text: [
            `Name: ${lead.first_name} ${lead.last_name}`,
            `Email: ${lead.email}`,
            `Phone: ${lead.phone}`,
            `Income sources: ${incomeSources.join(", ")}`,
            `Income: ${lead.income_bracket}`,
            `State: ${lead.state}`,
            `Financial year: ${lead.financial_year}`,
          ].join("\n"),
        }),
      });
    } catch (emailError) {
      // Don't fail the request if the email fails — the lead is already saved.
      console.error("notification email failed", emailError);
    }
  }

  return json(200, { ok: true });
});
