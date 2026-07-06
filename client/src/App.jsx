import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import TransferDetail from './components/TransferDetail.jsx';
import PublicDownload from './components/PublicDownload.jsx';

function AdminGate({ children }) {
  const [state, setState] = useState('checking'); // checking | authed | anon
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then((r) => setState(r.authed ? 'authed' : 'anon'))
      .catch(() => setState('anon'));
  }, []);

  if (state === 'checking') return <FullscreenSpinner />;
  if (state === 'anon') {
    navigate('/admin/login', { replace: true });
    return null;
  }
  return children;
}

function FullscreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <AdminGate>
            <Dashboard />
          </AdminGate>
        }
      />
      <Route
        path="/admin/t/:id"
        element={
          <AdminGate>
            <TransferDetail />
          </AdminGate>
        }
      />
      <Route path="/t/:slug" element={<PublicDownload />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
