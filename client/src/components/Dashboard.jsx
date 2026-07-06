import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, File as FileIcon, X, LogOut, Droplet, Copy, Trash2, ExternalLink } from 'lucide-react';
import { api, uploadFileChunked } from '../api.js';
import { Button, Card, Input, Label, ProgressBar, Badge, formatBytes, timeUntil } from './ui.jsx';

export default function Dashboard() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [expiryDays, setExpiryDays] = useState(7);
  const [password, setPassword] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progressByFile, setProgressByFile] = useState({});
  const [error, setError] = useState('');
  const [transfers, setTransfers] = useState([]);
  const [storage, setStorage] = useState(null);
  const inputRef = useRef(null);

  const refresh = useCallback(() => {
    api.listTransfers().then(setTransfers).catch(() => {});
    api.storage().then(setStorage).catch(() => {});
  }, []);

  useEffect(() => refresh(), [refresh]);

  function addFiles(list) {
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function startTransfer() {
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      const transfer = await api.createTransfer({
        expiryDays: Number(expiryDays) || 7,
        password: password || undefined,
        maxDownloads: maxDownloads ? Number(maxDownloads) : undefined,
        message
      });

      for (const file of files) {
        await uploadFileChunked(transfer.id, file, {
          onProgress: (done, total) => setProgressByFile((prev) => ({ ...prev, [file.name]: (done / total) * 100 }))
        });
      }

      await api.finalizeTransfer(transfer.id);
      navigate(`/admin/t/${transfer.id}`);
    } catch (e) {
      setError(e.message || 'Upload failed');
      setUploading(false);
    }
  }

  async function copyLink(t) {
    const url = `${location.origin}/t/${t.slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {}
  }

  async function deleteNow(t) {
    if (!confirm(`Delete transfer "${t.message || t.slug}"? This removes the files immediately.`)) return;
    await api.deleteTransfer(t.id);
    refresh();
  }

  const usedPct = storage ? Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <Header onLogout={() => navigate('/admin/login')} />

      <div className="mx-auto max-w-4xl px-6">
        {storage && (
          <Card className="mb-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-zinc-400">Storage</span>
              <span className="text-zinc-300">
                {formatBytes(storage.usedBytes)} / {storage.quotaGB} GB
              </span>
            </div>
            <ProgressBar value={usedPct} tone={usedPct > 90 ? 'red' : usedPct > 70 ? 'amber' : 'violet'} />
            {!storage.smtpConfigured && (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                SMTP isn't configured — you can still share links manually, but the "email this link" feature will no-op. Set SMTP_HOST/USER/PASS in
                .env to enable it.
              </p>
            )}
          </Card>
        )}

        <Card className="mb-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragOver ? 'border-violet-500 bg-violet-500/10' : 'border-white/10 hover:border-white/20'
            }`}
          >
            <UploadCloud className={`h-9 w-9 ${dragOver ? 'text-violet-400' : 'text-zinc-500'}`} />
            <p className="text-sm text-zinc-300">Drag files here, or click to browse</p>
            <p className="text-xs text-zinc-600">No practical size limit — uploads stream to disk in 5MB chunks</p>
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          </div>

          <AnimatePresence>
            {files.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2">
                    <FileIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200">{f.name}</p>
                      <p className="text-xs text-zinc-500">{formatBytes(f.size)}</p>
                      {progressByFile[f.name] !== undefined && (
                        <ProgressBar value={progressByFile[f.name]} className="mt-1.5" tone="green" />
                      )}
                    </div>
                    {!uploading && (
                      <button onClick={() => removeFile(i)} className="text-zinc-600 hover:text-red-400">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <Label>Expires in (days)</Label>
              <Input type="number" min="0" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
            </div>
            <div>
              <Label>Password (optional)</Label>
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="none" />
            </div>
            <div>
              <Label>Max downloads (optional)</Label>
              <Input type="number" min="1" value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} placeholder="unlimited" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label>Message to recipient</Label>
              <Input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="optional note" />
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <Button className="mt-6 w-full" disabled={!files.length || uploading} onClick={startTransfer}>
            {uploading ? 'Uploading…' : `Create transfer & upload ${files.length ? `(${files.length})` : ''}`}
          </Button>
        </Card>

        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Transfers</h2>
        <div className="space-y-3">
          {transfers.length === 0 && <p className="text-sm text-zinc-600">No transfers yet — drop some files above.</p>}
          {transfers.map((t) => (
            <Card key={t.id} className="!p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/admin/t/${t.id}`)}>
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-zinc-100">{t.message || t.files.map((f) => f.name).join(', ') || t.slug}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {t.files.length} file{t.files.length !== 1 ? 's' : ''} · {formatBytes(t.total_bytes)} · {t.download_count}
                    {t.max_downloads != null ? `/${t.max_downloads}` : ''} downloads · expires {timeUntil(t.expires_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="ghost" onClick={() => copyLink(t)} title="Copy link">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" onClick={() => window.open(`/t/${t.slug}`, '_blank')} title="Open link">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button variant="danger" onClick={() => deleteNow(t)} title="Delete now">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = { ready: 'green', uploading: 'amber', expired: 'red', deleted: 'zinc' };
  return <Badge tone={map[status] || 'zinc'}>{status}</Badge>;
}

function Header({ onLogout }) {
  async function logout() {
    await api.logout();
    onLogout();
  }
  return (
    <div className="mx-auto mb-8 flex max-w-4xl items-center justify-between px-6 pt-8">
      <div className="flex items-center gap-2">
        <div className="rounded-xl bg-violet-600/20 p-2">
          <Droplet className="h-5 w-5 text-violet-400" />
        </div>
        <h1 className="text-lg font-semibold text-zinc-100">Droplink</h1>
      </div>
      <Button variant="subtle" onClick={logout}>
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}
