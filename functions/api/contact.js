// Cloudflare Pages Function: receives the contact form and relays it to the
// site owner's email. The address is read from the CONTACT_EMAIL secret (set via
// `wrangler pages secret put`) so it never appears in the page source or the repo.

export async function onRequestPost({ request, env }) {
  const to = env.CONTACT_EMAIL;
  if (!to) return json({ ok: false, error: "not_configured" }, 500);

  let data;
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await request.json();
    } else {
      data = Object.fromEntries((await request.formData()).entries());
    }
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Honeypot: bots fill hidden fields. Pretend success, deliver nothing.
  if (data._gotcha) return json({ ok: true });

  const name = String(data.name || "").trim();
  const contact = String(data.contact || "").trim();
  if (!name || !contact) return json({ ok: false, error: "missing_fields" }, 400);

  const payload = {
    name,
    business: String(data.business || "").trim(),
    contact,
    about: String(data.about || "").trim(),
    _subject: `New lead from Sites Right Now — ${name}`,
    _template: "table",
  };

  // FormSubmit rejects calls without a browser-style Origin/Referer, so pass the
  // site's own origin along with the relay request.
  const origin = new URL(request.url).origin;
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: origin,
        Referer: origin + "/",
      },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => null);
    // FormSubmit returns HTTP 200 with success:"true" on delivery. Before the
    // one-time activation it returns success:"false" with an activation notice —
    // treat that as pending, not a hard failure.
    if (!res.ok || !result) return json({ ok: false, error: "delivery_failed" }, 502);
    if (String(result.success) === "true") return json({ ok: true });
    if (/activation/i.test(result.message || "")) return json({ ok: true, pending: true });
    return json({ ok: false, error: "delivery_failed" }, 502);
  } catch {
    return json({ ok: false, error: "delivery_failed" }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
