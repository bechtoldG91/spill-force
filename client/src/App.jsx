import { Navigate, Route, Routes } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { HomePage } from './pages/HomePage';
import { UploadPage } from './pages/UploadPage';
import { LibraryPage } from './pages/LibraryPage';
import { AnalysisPage } from './pages/AnalysisPage';

function Toast({ message }) {
  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-tactical-pitch/30 bg-tactical-ink px-4 py-3 text-sm font-semibold text-white shadow-glow transition ${
        message ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      {message}
    </div>
  );
}

export default function App() {
  const [toast, setToast] = useState('');

  const showToast = useCallback((message) => {
    setToast(String(message || ''));
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  return (
    <>
      <Routes>
        <Route
          path="*"
          element={
            <AppShell>
              <Routes>
                <Route path="/" element={<HomePage showToast={showToast} />} />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route path="/upload" element={<UploadPage showToast={showToast} />} />
                <Route path="/upload.html" element={<Navigate to="/upload" replace />} />
                <Route path="/biblioteca" element={<LibraryPage showToast={showToast} />} />
                <Route path="/biblioteca.html" element={<Navigate to="/biblioteca" replace />} />
                <Route path="/analise" element={<AnalysisPage showToast={showToast} />} />
                <Route path="/analise.html" element={<Navigate to="/analise" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          }
        />
      </Routes>

      <Toast message={toast} />
    </>
  );
}
