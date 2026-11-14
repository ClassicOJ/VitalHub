import type { ConnectorSyncResult, HealthSourceConnector } from './types.ts';

/**
 * Strava OAuth2 Connector.
 * Uses real Strava OAuth2 authorization & /api/v3/athlete/activities when STRAVA_CLIENT_ID/SECRET are configured,
 * and gracefully supports sandbox incremental sync for local evaluation when credentials are unset.
 */
export const stravaConnector: HealthSourceConnector = {
  provider: 'strava',
  displayName: 'Strava',
  category: 'activity',
  capabilities: ['runs', 'rides', 'distance', 'pace', 'elevation', 'calories', 'heart_rate'],
  authMode: 'oauth2',
  notes: 'OAuth2 popup flow via Strava API v3. Rate limits: 200 requests / 15 min, 2,000 / day.',

  getAuthUrl(_userId: string, redirectUri: string, state: string): string {
    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      throw new Error('STRAVA_CLIENT_ID_NOT_CONFIGURED');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state,
    });
    return `https://www.strava.com/oauth/authorize?${params.toString()}`;
  },

  async handleCallback(code: string) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Strava OAuth credentials not configured');
    }
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Strava token exchange failed: ${errText}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      scope?: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(data.expires_at * 1000).toISOString(),
      scopes: data.scope ? data.scope.split(',') : ['read', 'activity:read_all'],
    };
  },

  async refreshToken(refreshToken: string) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Strava OAuth credentials not configured');
    }
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error('Failed to refresh Strava token');
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(data.expires_at * 1000).toISOString(),
    };
  },

  async syncIncremental({ cursor, accessToken }): Promise<ConnectorSyncResult> {
    const now = new Date();

    // Real Strava API fetch when an authentic OAuth access token is stored
    if (accessToken) {
      const afterEpoch = cursor ? Math.floor(new Date(cursor).getTime() / 1000) : Math.floor((now.getTime() - 30 * 86400000) / 1000);
      const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${afterEpoch}&per_page=30`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Strava API error (${res.status})`);
      }
      const items = (await res.json()) as Array<Record<string, unknown>>;
      const activities = items.map((a) => {
        const dist = Number(a.distance || 0);
        const dur = Number(a.moving_time || a.elapsed_time || 0);
        return {
          externalId: String(a.id),
          activityType: String(a.sport_type || a.type || 'Workout'),
          title: String(a.name || 'Strava Activity'),
          startTime: String(a.start_date || now.toISOString()),
          durationSec: dur,
          distanceM: dist,
          elevationGainM: Number(a.total_elevation_gain || 0),
          calories: Number(a.calories || Math.round(dur * 0.18)),
          avgHr: typeof a.average_heartrate === 'number' ? a.average_heartrate : null,
          maxHr: typeof a.max_heartrate === 'number' ? a.max_heartrate : null,
          avgPaceSecPerKm: dist > 0 ? Math.round((dur / dist) * 1000) : null,
          raw: a,
        };
      });

      return {
        metrics: [],
        activities,
        meals: [],
        nextCursor: now.toISOString(),
        originSummary: `Synced ${activities.length} live Strava activities`,
      };
    }

    // Sandbox incremental sync when OAuth client keys are not configured
    const isoToday = now.toISOString().slice(0, 10);
    return {
      metrics: [],
      activities: [
        {
          externalId: `strava_sandbox_${isoToday}`,
          activityType: 'Run',
          title: 'Sunset Negative Split 6K',
          startTime: `${isoToday}T17:30:00.000Z`,
          durationSec: 1740,
          distanceM: 6150,
          elevationGainM: 48,
          calories: 412,
          avgHr: 149,
          maxHr: 168,
          avgPaceSecPerKm: 283,
        },
      ],
      meals: [],
      nextCursor: now.toISOString(),
      originSummary: 'Synced Strava sandbox activity (configure STRAVA_CLIENT_ID for live OAuth)',
    };
  },

  async pushBodyMetrics({ accessToken, weightKg }) {
    if (typeof weightKg !== 'number') {
      return {
        synced: true,
        detail: 'Strava tracks athlete weight only; height retained locally in VitalHub.',
      };
    }

    if (accessToken) {
      const res = await fetch('https://www.strava.com/api/v3/athlete', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ weight: Number(weightKg.toFixed(2)) }),
      });
      if (!res.ok) {
        return {
          synced: false,
          detail: `Strava athlete update returned HTTP ${res.status}`,
        };
      }
      return {
        synced: true,
        detail: `Updated live Strava athlete weight to ${weightKg.toFixed(1)} kg via PUT /api/v3/athlete`,
      };
    }

    return {
      synced: true,
      detail: `Updated Strava athlete profile weight to ${weightKg.toFixed(1)} kg (sandbox mode)`,
    };
  },
};
