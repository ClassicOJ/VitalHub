import { AlertTriangle, RefreshCw, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import type { AIEvaluation, EscalationAlert, HealthSnapshot } from '../types';

interface AiInsightsProps {
  snapshot: HealthSnapshot | null;
  onEvaluated: () => Promise<void>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ source: string; metricOrTest: string; value: string; date: string }>;
}

export function AiInsightsScreen({ snapshot, onEvaluated }: AiInsightsProps) {
  const [generating, setGenerating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Ask anything about your synced vitals, workouts, sleep stages, meals, or confirmed lab results. Answers are grounded strictly in your personal records with source citations.',
    },
  ]);

  const evaluation: AIEvaluation | null = snapshot?.latestEvaluation || null;

  const handleGenerate = async () => {
    setGenerating(true);
    setEvalError(null);
    try {
      await apiFetch('/api/ai/evaluate', { method: 'POST' });
      await onEvaluated();
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'AI Evaluation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleAsk = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim() || asking) return;
    const q = question.trim();
    setQuestion('');
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: q }];
    setChatHistory(nextHistory);
    setAsking(true);

    try {
      const res = await apiFetch<{
        answer: string;
        citations: Array<{ source: string; metricOrTest: string; value: string; date: string }>;
        escalationBanner: EscalationAlert;
      }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          question: q,
          history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: res.answer, citations: res.citations },
      ]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Unable to reach AI health assistant.',
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const suggestedPrompts = [
    'How did my HbA1c and fasting glucose change across lab reports?',
    'What is the relationship between my sleep duration and resting HR?',
    'Which biomarkers are currently outside the reference range?',
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">AI Health Evaluation & Grounded Chat</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pseudonymized synthesis via Gemini · Informational wellness guidance only, not medical advice
          </p>
        </div>

        <button
          type="button"
          disabled={generating}
          onClick={handleGenerate}
          className="min-h-[42px] inline-flex items-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-4 py-2 text-xs font-bold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Evaluating 90-Day Data...' : 'Generate Fresh Evaluation'}
        </button>
      </div>

      {evalError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {evalError}
        </div>
      )}

      {evaluation?.escalationAlert?.triggered && (
        <div className="rounded-2xl border border-rose-500/60 bg-rose-500/10 p-5 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-200">Urgent Clinical Escalation</p>
            <p className="text-sm text-rose-100 mt-1">{evaluation.escalationAlert.message}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Evaluation Breakdown */}
        <div className="lg:col-span-7 space-y-5">
          {!evaluation ? (
            <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-8 text-center">
              <p className="text-sm text-slate-500">
                No AI evaluation generated yet. Click "Generate Fresh Evaluation" to analyze your health trends.
              </p>
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="text-xs font-mono text-slate-400">
                      Overall Health Score · Generated {evaluation.createdAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 text-4xl font-semibold font-mono tabular-nums text-teal-500">
                      {evaluation.overallScore} <span className="text-sm text-slate-400">/ 100</span>
                    </p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {evaluation.summary}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <h4 className="text-xs font-semibold text-teal-400 mb-2">Key Strengths</h4>
                    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                      {evaluation.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-amber-400 mb-2">Areas of Concern</h4>
                    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                      {evaluation.concerns.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-4">
                <h3 className="text-base font-semibold">7, 30 & 90-Day Trends and Correlations</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <p className="font-mono text-slate-400 mb-1">7-Day Window</p>
                    <p className="text-slate-700 dark:text-slate-300">{evaluation.trends.days7}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <p className="font-mono text-slate-400 mb-1">30-Day Window</p>
                    <p className="text-slate-700 dark:text-slate-300">{evaluation.trends.days30}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <p className="font-mono text-slate-400 mb-1">90-Day Window</p>
                    <p className="text-slate-700 dark:text-slate-300">{evaluation.trends.days90}</p>
                  </div>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 pt-3">
                  {evaluation.correlations.map((corr, i) => (
                    <div key={i} className="py-2.5">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{corr.pair}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{corr.finding}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-3">
                <h3 className="text-base font-semibold">Prioritized Recommendations</h3>
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {evaluation.recommendations.map((rec) => (
                    <div key={rec.priority} className="py-3">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        0{rec.priority}. {rec.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{rec.rationale}</p>
                    </div>
                  ))}
                </div>
                <p className="pt-2 text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800">
                  {evaluation.disclaimer}
                </p>
              </section>
            </>
          )}
        </div>

        {/* Grounded "Ask my data" Chat */}
        <section className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] flex flex-col h-[640px]">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-semibold">Ask My Data</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Grounded only in your VitalHub metrics, labs, and meals
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`rounded-xl p-3.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-teal-500/15 text-slate-100 ml-8'
                    : 'bg-slate-100 dark:bg-white/[0.04] text-slate-800 dark:text-slate-200 mr-4'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 border-t border-slate-700/40 pt-2 space-y-1">
                    <p className="text-[11px] font-mono text-slate-400">Sources cited:</p>
                    {msg.citations.map((c, ci) => (
                      <p key={ci} className="text-[11px] font-mono text-teal-400">
                        {c.metricOrTest}: {c.value} · {c.date} · {c.source}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {asking && (
              <div className="rounded-xl bg-slate-100 dark:bg-white/[0.04] p-3 text-xs text-slate-400 mr-4">
                Querying your normalized telemetry...
              </div>
            )}
          </div>

          <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {suggestedPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setQuestion(p)}
                  className="text-left text-[11px] text-slate-400 hover:text-teal-400 border border-slate-800 rounded-lg px-2.5 py-1 truncate max-w-full"
                >
                  {p}
                </button>
              ))}
            </div>
            <form onSubmit={handleAsk} className="flex items-center gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about your trends or labs..."
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 text-sm focus:border-teal-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-50"
                aria-label="Send question"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
