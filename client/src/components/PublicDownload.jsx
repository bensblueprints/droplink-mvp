import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Droplet, Lock, Download, FileText, Image as ImageIcon, Archive, Clock } from 'lucide-react';
import { api } from '../api.js';
import { Button, Card, Input, Label, formatBytes, timeUntil } from './ui.jsx';

export default function PublicDownload() {
  const { slug } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .publicMeta(slug)
      .then(setMeta)
      .catch((e) => setError(e.data?.error === 'expired' || e.status === 410 ? 'expired' : 'notfound'));
  }, [slug]);

  async function unlock(e) {
    e.preventDefault();
    setBusy(true);
    setUnlockError('');
    try {
      const r = await api.publicUnlock(slug, password);
      setMeta({ ...r, password_required: false });
    } catch (e) {
      setUnlockError(e.message || 'Wrong password');
    } finally {
      setBusy(false);
    }
  }

  if (error === 'expired') return <StateScreen icon={<Clock className="h-8 w-8 text-amber-400" />} title="This link has expired" text="Ask the sender for a new one." />;
  if (error === 'notfound') return <StateScreen icon={<Clock className="h-8 w-8 text-red-400" />} title="Not found" text="This link doesn't exist." />;
  if (!meta) return null;

  if (meta.password_required) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="w-full max-w-sm">
          <Brand />
          <Card>
            <p className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
              <Lock className="h-4 w-4" /> This transfer is password protected
            </p>
            <form onSubmit={unlock} className="space-y-3">
              <div>
                <Label>Password</Label>
                <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {unlockError && <p className="text-sm text-red-400">{unlockError}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Checking…' : 'Unlock'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="mx-auto max-w-2xl pt-8">
        <Brand />
        <Card>
          {meta.message && <p className="mb-4 rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-300">"{meta.message}"</p>}
          <p className="mb-4 text-xs text-zinc-500">
            Expires in {timeUntil(meta.expires_at)}
            {meta.max_downloads != null ? ` · ${meta.max_downloads - meta.download_count} download(s) left` : ''}
          </p>

          <div className="space-y-2">
            {meta.files.map((f) => (
              <FileRow key={f.id} file={f} slug={slug} token={meta.token} />
            ))}
          </div>

          {meta.files.length > 1 && (
            <Button className="mt-5 w-full" onClick={() => (window.location.href = `/dl/${slug}/zip?token=${meta.token}`)}>
              <Archive className="h-4 w-4" /> Download all as ZIP
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}

function FileRow({ file, slug, token }) {
  const isImage = /^image\//.test(file.mime);
  const isPdf = file.mime === 'application/pdf';
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-3">
        {isImage ? <ImageIcon className="h-5 w-5 text-violet-400" /> : <FileText className="h-5 w-5 text-zinc-500" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-200">{file.name}</p>
          <p className="text-xs text-zinc-500">{formatBytes(file.size_bytes)}</p>
        </div>
        <Button variant="ghost" onClick={() => (window.location.href = `/dl/${slug}/${file.id}?token=${token}`)}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
      {isImage && (
        <img src={`/preview/${slug}/${file.id}?token=${token}`} alt={file.name} className="mt-3 max-h-64 w-full rounded-lg object-contain" />
      )}
      {isPdf && <iframe title={file.name} src={`/preview/${slug}/${file.id}?token=${token}`} className="mt-3 h-72 w-full rounded-lg bg-white" />}
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2">
      <div className="rounded-xl bg-violet-600/20 p-2">
        <Droplet className="h-5 w-5 text-violet-400" />
      </div>
      <span className="text-sm font-medium text-zinc-400">Droplink</span>
    </div>
  );
}

function StateScreen({ icon, title, text }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center">
      {icon}
      <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
      <p className="text-sm text-zinc-500">{text}</p>
    </div>
  );
}
