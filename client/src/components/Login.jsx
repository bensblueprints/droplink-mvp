import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Droplet, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Card, Input, Label } from './ui.jsx';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      navigate('/admin');
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-2xl bg-violet-600/20 p-3">
            <Droplet className="h-7 w-7 text-violet-400" />
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Droplink</h1>
          <p className="text-sm text-zinc-500">Send big files from your own server.</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Admin password</Label>
              <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-red-400">
                <Lock className="h-3.5 w-3.5" /> {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
