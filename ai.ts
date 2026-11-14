import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createPseudonymousSubjectId } from './crypto.ts';
import { checkSafetyEscalation, evaluateLabFlag, type EscalationAlert } from './normalization.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ExtractedLabItem {
  testName: string;
  testCode: string;
  value: number;
  unit: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  referenceText: string;
  flag: 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';
}

export interface LabExtractionOutput {
  labName: string;
  collectedAt: string;
  ocrRawText: string;
  results: ExtractedLabItem[];
}

/**
 * Prompt Template 1: Lab Report OCR + Structured Extraction.
 * Supports PDF, PNG, JPEG via inlineData, or plain text OCR input.
 */
export async function extractLabReportWithGemini(params: {
  fileBuffer?: Buffer;
  mimeType?: string;
  rawText?: string;
  fallbackTitle?: string;
}): Promise<LabExtractionOutput> {
  const ai = getAiClient();

  const systemInstruction = `You are a clinical laboratory document extraction engine.
Your job is to transcribe all visible biomarker rows from the provided lab report accurately.
Rules:
1. Extract testName, optional testCode (LOINC or abbreviation), numeric value, unit, numeric referenceLow (or null), numeric referenceHigh (or null), and referenceText.
2. Never invent numbers not present in the document. If a reference range is "< 100", set referenceLow to 0 and referenceHigh to 100. If ">= 45", set referenceLow to 45 and referenceHigh to null.
3. Exclude patient PII (name, SSN, address, DOB) from ocrRawText by redacting them as [REDACTED].
4. Output strictly valid JSON matching the schema.`;

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (params.fileBuffer && params.mimeType) {
    parts.push({
      inlineData: {
        mimeType: params.mimeType,
        data: params.fileBuffer.toString('base64'),
      },
    });
  }
  parts.push({
    text: params.rawText
      ? `Extract structured lab results from this report text:\n\n${params.rawText}`
      : `Perform OCR and extract all lab test names, numeric values, units, and reference ranges from the attached lab report (${params.fallbackTitle || 'Lab Panel'}).`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          labName: { type: Type.STRING, description: 'Laboratory provider name, e.g. Quest Diagnostics' },
          collectedAt: { type: Type.STRING, description: 'ISO 8601 date of specimen collection if visible, else today ISO date' },
          ocrRawText: { type: Type.STRING, description: 'Redacted clean text transcription of the lab report lines' },
          results: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                testName: { type: Type.STRING },
                testCode: { type: Type.STRING },
                value: { type: Type.NUMBER },
                unit: { type: Type.STRING },
                referenceLow: { type: Type.NUMBER, nullable: true },
                referenceHigh: { type: Type.NUMBER, nullable: true },
                referenceText: { type: Type.STRING },
              },
              required: ['testName', 'value', 'unit', 'referenceText'],
            },
          },
        },
        required: ['labName', 'collectedAt', 'ocrRawText', 'results'],
      },
    },
  });

  const rawJson = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawJson) as {
    labName?: string;
    collectedAt?: string;
    ocrRawText?: string;
    results?: Array<{
      testName: string;
      testCode?: string;
      value: number;
      unit: string;
      referenceLow?: number | null;
      referenceHigh?: number | null;
      referenceText?: string;
    }>;
  };

  const validDate =
    parsed.collectedAt && !Number.isNaN(new Date(parsed.collectedAt).getTime())
      ? new Date(parsed.collectedAt).toISOString()
      : new Date().toISOString();

  const results: ExtractedLabItem[] = (parsed.results || []).map((r) => ({
    testName: r.testName,
    testCode: r.testCode || '',
    value: Number(r.value),
    unit: r.unit,
    referenceLow: typeof r.referenceLow === 'number' ? r.referenceLow : null,
    referenceHigh: typeof r.referenceHigh === 'number' ? r.referenceHigh : null,
    referenceText: r.referenceText || '',
    flag: evaluateLabFlag(Number(r.value), r.referenceLow, r.referenceHigh, r.testName),
  }));

  return {
    labName: parsed.labName || 'Clinical Laboratory',
    collectedAt: validDate,
    ocrRawText: parsed.ocrRawText || '',
    results,
  };
}

export interface HealthEvaluationOutput {
  overallScore: number;
  subScores: {
    cardiovascular: number;
    sleep: number;
    activity: number;
    nutrition: number;
    metabolicLabs: number;
    recoveryStress: number;
  };
  summary: string;
  strengths: string[];
  concerns: string[];
  trends: {
    days7: string;
    days30: string;
    days90: string;
  };
  correlations: Array<{ pair: string; finding: string }>;
  recommendations: Array<{
    priority: number;
    title: string;
    rationale: string;
    category: string;
  }>;
  escalationAlert: EscalationAlert;
  disclaimer: string;
  modelUsed: string;
}

/**
 * Prompt Template 2: Comprehensive AI Health Evaluation.
 * Pseudonymizes user identity and applies deterministic clinical safety escalation guardrails.
 */
export async function generateHealthEvaluationWithGemini(params: {
  userId: string;
  metricsSummary: Record<string, unknown>;
  activitiesSummary: Array<Record<string, unknown>>;
  nutritionSummary: Record<string, unknown>;
  labResults: Array<{ testName: string; value: number; unit: string; referenceText: string; flag: string; collectedAt: string }>;
  safetyInput: {
    latestSystolicBp?: number | null;
    latestDiastolicBp?: number | null;
    latestGlucoseMgDl?: number | null;
    latestSpo2?: number | null;
  };
}): Promise<HealthEvaluationOutput> {
  const ai = getAiClient();
  const pseudonymousId = createPseudonymousSubjectId(params.userId);

  // Deterministic safety guardrail runs independently of LLM
  const deterministicEscalation = checkSafetyEscalation({
    ...params.safetyInput,
    criticalLabs: params.labResults.filter((l) => l.flag.startsWith('critical')),
  });

  const systemInstruction = `You are a preventative health data analyst inside VitalHub.
Analyze ONLY the pseudonymized biometric, activity, nutrition, and confirmed lab data provided.
CRITICAL SAFETY RULES:
1. NEVER diagnose any medical condition or disease.
2. NEVER recommend starting, stopping, or changing prescription medications or dosages.
3. Ground every observation in exact numbers, dates, and units from the supplied data.
4. If values indicate hypertensive crisis (>=180/120 mmHg), severe dysglycemia (>=250 or <=54 mg/dL), SpO2 <=90%, or critical lab flags, set urgentEscalationNeeded to true and advise prompt clinical evaluation.
5. Keep tone calm, encouraging, objective, and non-alarmist (except when urgent escalation applies).
6. Provide 3 to 5 prioritized, actionable lifestyle/habit recommendations.`;

  const promptPayload = {
    subject: pseudonymousId,
    metricsSummary: params.metricsSummary,
    recentActivities: params.activitiesSummary,
    nutritionSummary: params.nutritionSummary,
    confirmedLabResults: params.labResults,
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Evaluate this pseudonymized 90-day health snapshot and return structured JSON:\n\n${JSON.stringify(promptPayload)}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallScore: { type: Type.INTEGER, description: '0-100 overall composite health index' },
          subScores: {
            type: Type.OBJECT,
            properties: {
              cardiovascular: { type: Type.INTEGER },
              sleep: { type: Type.INTEGER },
              activity: { type: Type.INTEGER },
              nutrition: { type: Type.INTEGER },
              metabolicLabs: { type: Type.INTEGER },
              recoveryStress: { type: Type.INTEGER },
            },
            required: ['cardiovascular', 'sleep', 'activity', 'nutrition', 'metabolicLabs', 'recoveryStress'],
          },
          summary: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
          trends: {
            type: Type.OBJECT,
            properties: {
              days7: { type: Type.STRING },
              days30: { type: Type.STRING },
              days90: { type: Type.STRING },
            },
            required: ['days7', 'days30', 'days90'],
          },
          correlations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pair: { type: Type.STRING },
                finding: { type: Type.STRING },
              },
              required: ['pair', 'finding'],
            },
          },
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                priority: { type: Type.INTEGER },
                title: { type: Type.STRING },
                rationale: { type: Type.STRING },
                category: { type: Type.STRING },
              },
              required: ['priority', 'title', 'rationale', 'category'],
            },
          },
          urgentEscalationNeeded: { type: Type.BOOLEAN },
          urgentEscalationReason: { type: Type.STRING },
        },
        required: [
          'overallScore',
          'subScores',
          'summary',
          'strengths',
          'concerns',
          'trends',
          'correlations',
          'recommendations',
          'urgentEscalationNeeded',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    overallScore: number;
    subScores: HealthEvaluationOutput['subScores'];
    summary: string;
    strengths: string[];
    concerns: string[];
    trends: HealthEvaluationOutput['trends'];
    correlations: Array<{ pair: string; finding: string }>;
    recommendations: Array<{ priority: number; title: string; rationale: string; category: string }>;
    urgentEscalationNeeded?: boolean;
    urgentEscalationReason?: string;
  };

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  const escalationAlert: EscalationAlert = deterministicEscalation.triggered
    ? deterministicEscalation
    : parsed.urgentEscalationNeeded
      ? {
          triggered: true,
          level: 'urgent',
          message:
            parsed.urgentEscalationReason ||
            'Recent health markers warrant prompt review with a licensed healthcare professional.',
          triggers: [parsed.urgentEscalationReason || 'Flagged physiological threshold'],
        }
      : { triggered: false, level: 'none', message: '', triggers: [] };

  return {
    overallScore: clamp(parsed.overallScore),
    subScores: {
      cardiovascular: clamp(parsed.subScores.cardiovascular),
      sleep: clamp(parsed.subScores.sleep),
      activity: clamp(parsed.subScores.activity),
      nutrition: clamp(parsed.subScores.nutrition),
      metabolicLabs: clamp(parsed.subScores.metabolicLabs),
      recoveryStress: clamp(parsed.subScores.recoveryStress),
    },
    summary: parsed.summary,
    strengths: parsed.strengths.slice(0, 5),
    concerns: parsed.concerns.slice(0, 5),
    trends: parsed.trends,
    correlations: parsed.correlations.slice(0, 4),
    recommendations: parsed.recommendations.slice(0, 5),
    escalationAlert,
    disclaimer: 'Informational only — not medical advice, diagnosis, or a substitute for clinical care.',
    modelUsed: 'gemini-4-hydrogen',
  };
}

/**
 * Prompt Template 3: Grounded "Ask My Data" Conversational Q&A with Source Citations.
 */
export async function askHealthDataWithGemini(params: {
  userId: string;
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  groundedContext: Record<string, unknown>;
  safetyInput: {
    latestSystolicBp?: number | null;
    latestDiastolicBp?: number | null;
    latestGlucoseMgDl?: number | null;
    latestSpo2?: number | null;
  };
}): Promise<{
  answer: string;
  citations: Array<{ source: string; metricOrTest: string; value: string; date: string }>;
  escalationBanner: EscalationAlert;
}> {
  const ai = getAiClient();
  const pseudonymousId = createPseudonymousSubjectId(params.userId);
  const escalationBanner = checkSafetyEscalation(params.safetyInput);

  const systemInstruction = `You are VitalHub's grounded personal health data assistant for ${pseudonymousId}.
Rules:
1. Answer ONLY using the provided groundedContext JSON (metrics, activities, meals, confirmed lab results, clinician notes).
2. If the user asks about data that is missing or not in groundedContext, clearly state what is missing rather than guessing.
3. NEVER diagnose diseases or recommend medication/dosage changes. Always maintain an informational framing ("not medical advice").
4. Cite exact metrics, lab reports, sources, values, and dates in the citations array.
5. Output valid JSON matching the schema.`;

  const prompt = JSON.stringify({
    conversationHistory: params.history.slice(-6),
    userQuestion: params.question,
    groundedContext: params.groundedContext,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          citations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source: { type: Type.STRING },
                metricOrTest: { type: Type.STRING },
                value: { type: Type.STRING },
                date: { type: Type.STRING },
              },
              required: ['source', 'metricOrTest', 'value', 'date'],
            },
          },
        },
        required: ['answer', 'citations'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    answer: string;
    citations?: Array<{ source: string; metricOrTest: string; value: string; date: string }>;
  };

  return {
    answer: parsed.answer,
    citations: parsed.citations || [],
    escalationBanner,
  };
}
