// Only the site's own pages may use the API. Browsers mark every request with
// Sec-Fetch-Site (same-origin for our pages) and send Origin on cross-site and
// POST requests; requests with neither (scripts, other sites, embeds) are refused.
// This is not authentication (headers can be forged outside a browser); rate
// limits and the provider's spending cap bound what remains.

/** True when the request comes from one of our own pages. */
export function fromOwnSite(headers, allowedOrigins) {
  if (headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = headers.get("origin");
  return origin !== null && allowedOrigins.includes(origin);
}

export function forbidden() {
  return new Response(JSON.stringify({ error: { message: "This API only serves Coderimpact's own pages." } }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
