async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { ...opts, headers, body, credentials: 'same-origin' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/me'),
  login: (password) => req('/api/login', { method: 'POST', json: { password } }),
  logout: () => req('/api/logout', { method: 'POST' }),

  storage: () => req('/api/storage'),

  listTransfers: () => req('/api/transfers'),
  createTransfer: (payload) => req('/api/transfers', { method: 'POST', json: payload }),
  getTransfer: (id) => req(`/api/transfers/${id}`),
  updateTransfer: (id, payload) => req(`/api/transfers/${id}`, { method: 'PUT', json: payload }),
  deleteTransfer: (id) => req(`/api/transfers/${id}`, { method: 'DELETE' }),
  finalizeTransfer: (id) => req(`/api/transfers/${id}/finalize`, { method: 'POST' }),
  emailTransfer: (id, payload) => req(`/api/transfers/${id}/email`, { method: 'POST', json: payload }),

  createUploadSession: (transferId, payload) => req(`/api/transfers/${transferId}/files`, { method: 'POST', json: payload }),
  uploadStatus: (sessionId) => req(`/api/uploads/${sessionId}/status`),
  uploadChunk: (sessionId, idx, blob) =>
    req(`/api/uploads/${sessionId}/chunk/${idx}`, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'application/octet-stream' }
    }),

  publicMeta: (slug) => req(`/api/public/t/${slug}`),
  publicUnlock: (slug, password) => req(`/api/public/t/${slug}/unlock`, { method: 'POST', json: { password } })
};

export const CHUNK_SIZE = 5 * 1024 * 1024;
export const MAX_RETRIES = 3;

// Uploads one file in chunks with retry + exponential backoff, resuming from
// whatever chunk indexes the server reports as already-received.
export async function uploadFileChunked(transferId, file, { onProgress } = {}) {
  const session = await api.createUploadSession(transferId, {
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    chunkSize: CHUNK_SIZE
  });

  const status = await api.uploadStatus(session.sessionId);
  const received = new Set(status.received);
  const totalChunks = session.totalChunks;
  let uploadedBytes = Math.min(received.size * CHUNK_SIZE, file.size);
  onProgress?.(uploadedBytes, file.size);

  for (let idx = 0; idx < totalChunks; idx++) {
    if (received.has(idx)) continue;
    const start = idx * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);

    let attempt = 0;
    for (;;) {
      try {
        await api.uploadChunk(session.sessionId, idx, blob);
        break;
      } catch (e) {
        attempt++;
        if (attempt >= MAX_RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 2 ** attempt * 300));
      }
    }
    uploadedBytes = Math.min(uploadedBytes + (end - start), file.size);
    onProgress?.(uploadedBytes, file.size);
  }

  return { fileId: session.fileId };
}
