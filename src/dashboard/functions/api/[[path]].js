export async function onRequest(context) {
  // context.request is the original Request object from the browser
  // context.params.path is the array of path segments after /api/
  
  const url = new URL(context.request.url);
  
  // Reconstruct the backend URL
  // e.g., https://cityflow.pages.dev/api/events -> http://142.93.222.0.nip.io:8000/api/events
  const backendUrl = `http://142.93.222.0.nip.io:8000${url.pathname}${url.search}`;
  
  // Forward the exact request to the backend
  return fetch(backendUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body
  });
}
