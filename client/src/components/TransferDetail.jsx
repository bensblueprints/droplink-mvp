import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Mail, Trash2, Download } from 'lucide-react';
import { api } from '../api.js';
import { Button, Card, Input, Label, Badge, formatBytes, timeUntil } from './ui.jsx';

export default function TransferDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [transfer, setTransfer] = useState(null);
  const [to, setTo] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailResult, setEmailResult] = useState(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    api.getTransfer(id).then(setTransfer).catch(() => navigate('/admin'));
  }

  useEffect(() => refresh(), [id]);

  if (!transfer) return null;

  const link = `${location.origin}/t/${transfer.slug}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
  }

  async function sendEmail(e) {
    e.preventDefault();
    setBusy(true);
    setEmailResult(null);
    try {
      const r = await api.emailTransfer(id, { to: to.split(',').map((s) => s.trim()).filter(Boolean), message: emailMessage });
      setEmailResult(r);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteNow() {
    if (!confirm('Delete this transfer and its files now?')) return;
    await api.deleteTransfer(id);
    navigate('/admin');
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <div className="mx-auto max-w-3xl px-6 pt-8">
        <button onClick={() => navigate('/admin')} className="mb-6 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </button>

        <Card className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <h1 className="text-lg font-semibold text-zinc-100">{transfer.message || `Transfer ${transfer.slug}`}</h1>
            <Badge tone={transfer.status === 'ready' ? 'green' : transfer.status === 'expired' ? 'red' : 'amber'}>{transfer.status}</Badge>
          </div>
          <p className="mb-4 text-sm text-zinc-500">
            {transfer.files.length} file(s) · {formatBytes(transfer.total_bytes)} · expires {timeUntil(transfer.expires_at)} ·{' '}
            {transfer.download_count}
            {transfer.max_downloads != null ? `/${transfer.max_downloads}` : ''} downloads
            {transfer.hasPassword ? ' · password protected' : ''}
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <code className="flex-1 truncate text-sm text-zinc-300">{link}</code>
            <Button variant="ghost" onClick={copyLink}>
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>

          <div className="mt-4 space-y-1.5">
            {transfer.files.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm">
                <span className="truncate text-zinc-300">{f.name}</span>
                <span className="text-zinc-500">{formatBytes(f.size_bytes)}</span>
              </div>
            ))}
          </div>

          <Button variant="danger" className="mt-6" onClick={deleteNow}>
            <Trash2 className="h-4 w-4" /> Delete now
          </Button>
        </Card>

        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Email the link</h2>
          <form onSubmit={sendEmail} className="space-y-3">
            <div>
              <Label>Recipients (comma-separated)</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com, team@example.com" />
            </div>
            <div>
              <Label>Message</Label>
              <Input value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} placeholder="optional note" />
            </div>
            <Button type="submit" disabled={busy || !to}>
              <Mail className="h-4 w-4" /> {busy ? 'Sending…' : 'Send'}
            </Button>
          </form>
          {emailResult?.warning && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">{emailResult.warning}</p>}
          {emailResult && !emailResult.warning && <p className="mt-3 text-xs text-emerald-400">Sent.</p>}
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-zinc-500">
            <Download className="h-4 w-4" /> Download log
          </h2>
          {transfer.downloads.length === 0 && <p className="text-sm text-zinc-600">No downloads yet.</p>}
          <div className="space-y-1.5">
            {transfer.downloads.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs text-zinc-400">
                <span>{new Date(d.downloaded_at).toLocaleString()}</span>
                <span>{d.ip}</span>
                <span>{d.file_id ? 'file' : 'zip-all'}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
