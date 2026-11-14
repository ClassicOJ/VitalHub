import { RefreshCw, Link2, Unlink, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { SourceItem } from '../types';

interface SourcesScreenProps {
  onSynced: () => Promise<void>;
}

export function SourcesScreen({ onSynced }: SourcesScreenProps) {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stravaCallbackUrl, setStravaCallbackUrl] = useState<string>('');
  const [importProvider, setImportProvider] = useState<'health_connect' | 'healthkit' | null>(null);
  const [importJson, setImportJson] = useState(
    JSON.stringify(
      {
        records: [
          {
            type: 'weight',
            value: 144.2,
            unit: 'lb',
            timestamp: new Date().toISOString(),
            dataOrigin: 'Fitbit Aria via Health Connect',
          },
          {
            type: 'glucose',
            value: 5.2,
            unit: 'mmol/L',
            timestamp: new Date().toISOString(),
            dataOrigin: 'Samsung Health Bridge',
          },
        ],
      },
      null,
      2
    )
  );

  const loadSources = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ sources: SourceItem[] }>('/api/sources');
      setSources(data.sources);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSources();

    const handleOAuthMsg = async (event: MessageEvent) => {
      if (!event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setStatusMessage(`Connected ${event.data.provider || 'OAuth source'} and synced latest records.`);
        await loadSources();
        await onSynced();
      }
    };
    window.addEventListener('message', handleOAuthMsg);
    return () => window.removeEventListener('message', handleOAuthMsg);
  }, []);

  const handleSync = async (provider: string) => {
    setSyncingProvider(provider);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const res = await apiFetch<{
        summary: string;
        metricsStored: number;
        metricsDeduplicated: number;
        activitiesStored: number;
        activitiesDeduplicated: number;
      }>(`/api/sources/${provider}/sync`, { method: 'POST' });

      setStatusMessage(
        `${res.summary} · ${res.metricsStored} metrics (${res.metricsDeduplicated} deduplicated) · ${res.activitiesStored} activities (${res.activitiesDeduplicated} deduplicated)`
      );
      await loadSources();
      await onSynced();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleStravaConnect = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const data = await apiFetch<{ configured: boolean; url?: string; callbackUrl: string; message?: string }>(
        '/api/sources/strava/auth-url'
      );
      setStravaCallbackUrl(data.callbackUrl);
      if (data.configured && data.url) {
        const popup = window.open(data.url, 'strava_oauth_popup', 'width=600,height=720');
        if (!popup) {
          setErrorMessage('Popup was blocked by your browser. Please allow popups for VitalHub.');
        }
      } else {
        // Run sandbox Strava sync cleanly when OAuth env credentials aren't configured
        await handleSync('strava');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to initialize Strava OAuth');
    }
  };

  const handleDisconnect = async (provider: string) => {
    await apiFetch(`/api/sources/${provider}/disconnect`, { method: 'POST' });
    await loadSources();
  };

  const handleJsonImport = async () => {
    if (!importProvider) return;
    setSyncingProvider(importProvider);
    setErrorMessage(null);
    try {
      const parsed = JSON.parse(importJson);
      const res = await apiFetch<{ summary: string; metricsStored: number; metricsDeduplicated: number }>(
        `/api/sources/${importProvider}/sync`,
        {
          method: 'POST',
          body: JSON.stringify({ payload: parsed }),
        }
      );
      setStatusMessage(`${res.summary} · ${res.metricsStored} normalized (${res.metricsDeduplicated} deduplicated)`);
      setImportProvider(null);
      await loadSources();
      await onSynced();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Invalid JSON payload');
    } finally {
      setSyncingProvider(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Connected Data Sources</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Pluggable HealthSourceConnector pipeline with incremental sync, OAuth token refresh, unit conversion, and cross-source priority resolution.
        </p>
      </div>

      {statusMessage && (
        <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorMessage}
        </div>
      )}

      {stravaCallbackUrl && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
          Strava OAuth Redirect URI: <span className="font-mono text-slate-200">{stravaCallbackUrl}</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-[28px] bg-slate-200 dark:bg-white/[0.05]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sources.map((src) => {
            const isConnected = src.status === 'connected';
            const isSyncing = syncingProvider === src.provider;
            return (
              <div
                key={src.provider}
                className="rounded-[28px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] backdrop-blur-md p-6 flex flex-col justify-between gap-4 hover:border-[#056583] transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                        {src.displayName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-white/55">
                        {src.status === 'connected' ? 'Connected' : src.status === 'error' ? 'Sync Error' : 'Not Connected'}
                        {' · '}Priority {src.priorityRank}
                        {src.lastSyncedAt ? ` · Synced ${new Date(src.lastSyncedAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-white/60">
                    {src.notes}
                  </p>

                  <p className="mt-2 text-xs font-mono text-slate-500 dark:text-white/45">
                    Capabilities: {src.capabilities.join(' · ')}
                  </p>

                  {src.lastError && (
                    <p className="mt-2 text-xs text-rose-400">Last error: {src.lastError}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
                  {src.provider === 'strava' && !isConnected ? (
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={handleStravaConnect}
                      className="min-h-[40px] inline-flex items-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-4 py-2 text-xs font-bold hover:opacity-90 whitespace-nowrap"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      {src.stravaOAuthConfigured ? 'Connect Strava OAuth' : 'Connect Strava (Sandbox)'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={() => handleSync(src.provider)}
                      className="min-h-[40px] inline-flex items-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-4 py-2 text-xs font-bold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      {isSyncing ? 'Syncing...' : isConnected ? 'Incremental Sync' : 'Connect & Sync'}
                    </button>
                  )}

                  {(src.provider === 'health_connect' || src.provider === 'healthkit') && (
                    <button
                      type="button"
                      onClick={() => setImportProvider(src.provider as 'health_connect' | 'healthkit')}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-[16px] border border-slate-300 dark:border-white/[0.12] px-3.5 py-2 text-xs font-medium hover:border-[#056583] whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" /> Import JSON
                    </button>
                  )}

                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => handleDisconnect(src.provider)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-[16px] border border-slate-300 dark:border-white/[0.12] px-3.5 py-2 text-xs font-medium text-slate-500 hover:text-rose-400 hover:border-rose-500/50 whitespace-nowrap"
                    >
                      <Unlink className="h-3.5 w-3.5" /> Disconnect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Health Connect / HealthKit JSON Payload Importer */}
      {importProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0d1418]/95 backdrop-blur-2xl p-6">
            <h3 className="text-lg font-semibold">
              Import {importProvider === 'health_connect' ? 'Health Connect' : 'HealthKit'} JSON Export
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/55">
              Test unit normalization (e.g. lb to kg, mmol/L to mg/dL) and cross-source deduplication directly.
            </p>
            <textarea
              rows={10}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              className="mt-4 w-full rounded-[16px] border border-slate-300 dark:border-white/[0.1] bg-slate-50 dark:bg-[#090e11] p-3 font-mono text-xs"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setImportProvider(null)}
                className="min-h-[42px] rounded-[16px] border border-slate-300 dark:border-white/[0.12] px-4 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleJsonImport}
                className="min-h-[42px] rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-5 py-2 text-xs font-bold hover:opacity-90"
              >
                Normalize & Ingest
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
