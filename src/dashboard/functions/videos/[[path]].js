// Cloudflare Pages Function — proxies /videos/* to the DO Flask backend.
// Mirrors the existing /api and /maps functions. The function passes
// Range headers through to the backend, which is required for the
// <video> element to seek in a 200–500 MB file.
export async function onRequest(context) {
  const url = new URL(context.request.url);

  // e.g., https://cityflow.pages.dev/videos/presentation.mp4
  //    -> http://142.93.222.0.nip.io:8000/videos/presentation.mp4
  const backendUrl = `http://142.93.222.0.nip.io:8000${url.pathname}${url.search}`;

  return fetch(backendUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });
}
