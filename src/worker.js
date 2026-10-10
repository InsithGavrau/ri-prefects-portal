export default {
  async fetch(request, env) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405 });
    }

    const assetUrl = new URL(request.url);
    assetUrl.search = "";

    const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
    const headers = new Headers(assetResponse.headers);

    if (headers.get("content-type")?.includes("text/html")) {
      const html = await assetResponse.text();
      headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      headers.set("X-Portal-Version", "portal-wordmark-20261010");
      headers.delete("Content-Length");

      return new Response(html, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
  }
};
