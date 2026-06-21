export async function onRequest(context) {
  const url = new URL(context.request.url);
  
  // Reconstruct the backend URL
  // e.g., https://cityflow.pages.dev/maps/map_123.html -> http://142.93.222.0.nip.io:8000/maps/map_123.html
  const backendUrl = `http://142.93.222.0.nip.io:8000${url.pathname}${url.search}`;
  
  return fetch(backendUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body
  });
}
