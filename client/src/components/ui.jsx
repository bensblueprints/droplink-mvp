import React from 'react';

export function Button({ children, className = '', variant = 'primary', ...rest }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-950/40',
    ghost: 'bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10',
    danger: 'bg-red-600/90 hover:bg-red-500 text-white',
    subtle: 'bg-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
  };
  return (
    <button className={`${base} ${variants[variant] || variants.primary} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur p-6 ${className}`}>{children}</div>;
}

export function Input({ className = '', ...rest }) {
  return (
    <input
      className={`w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 ${className}`}
      {...rest}
    />
  );
}

export function Label({ children, className = '' }) {
  return <label className={`mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500 ${className}`}>{children}</label>;
}

export function ProgressBar({ value, className = '', tone = 'violet' }) {
  const tones = {
    violet: 'bg-violet-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500'
  };
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-white/10 ${className}`}>
      <div
        className={`h-full rounded-full ${tones[tone] || tones.violet} transition-all duration-300`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Badge({ children, tone = 'zinc' }) {
  const tones = {
    zinc: 'bg-white/10 text-zinc-300',
    green: 'bg-emerald-500/15 text-emerald-400',
    amber: 'bg-amber-500/15 text-amber-400',
    red: 'bg-red-500/15 text-red-400',
    violet: 'bg-violet-500/15 text-violet-300'
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone] || tones.zinc}`}>{children}</span>;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function timeUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
