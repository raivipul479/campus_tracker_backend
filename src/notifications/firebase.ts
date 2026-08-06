import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
import { config } from '../config.js';

// Lazily initialise the Firebase Admin SDK from the configured service account.
// Returns null (and disables sending) if no service account is configured, so
// the rest of the app keeps working — notifications are stored either way.
let messaging: admin.messaging.Messaging | null | undefined;

function loadServiceAccount(): admin.ServiceAccount | null {
  const raw = config.firebase.serviceAccount.trim();
  if (!raw) return null;

  try {
    // Accept: a path to a JSON file, raw JSON, or base64-encoded JSON.
    if (raw.startsWith('{')) {
      return JSON.parse(raw);
    }
    if (raw.endsWith('.json')) {
      return JSON.parse(readFileSync(raw, 'utf8'));
    }
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('[firebase] Failed to load service account:', (error as Error).message);
    return null;
  }
}

function getMessaging(): admin.messaging.Messaging | null {
  if (messaging !== undefined) return messaging;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    console.warn('[firebase] No service account configured — push delivery is disabled.');
    messaging = null;
    return null;
  }

  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  messaging = app.messaging();
  return messaging;
}

export function isPushEnabled() {
  return getMessaging() !== null;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Sends a notification to a set of device tokens. Returns the tokens that are
 * permanently invalid (unregistered/not-found) so the caller can prune them.
 */
export async function sendToTokens(tokens: string[], payload: PushPayload): Promise<string[]> {
  const fcm = getMessaging();
  if (!fcm || tokens.length === 0) return [];

  const staleTokens: string[] = [];

  // FCM sendEachForMulticast handles up to 500 tokens per call.
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    try {
      const response = await fcm.sendEachForMulticast({
        tokens: batch,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } }
      });

      response.responses.forEach((result, index) => {
        if (result.success) return;
        const code = result.error?.code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          staleTokens.push(batch[index]);
        }
      });
    } catch (error) {
      console.error('[firebase] send failed:', (error as Error).message);
    }
  }

  return staleTokens;
}
