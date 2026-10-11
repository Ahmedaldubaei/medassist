/**
 * Google ID token verification for Sign-In with Google.
 * Kept in its own module so tests can mock it via vi.mock('../src/lib/google.js').
 */
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

const client = new OAuth2Client();

export interface GoogleProfile {
  email: string;
  name: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  const ticket = await client.verifyIdToken({ idToken, audience: config.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.email || payload.email_verified !== true) {
    throw new Error('Google account email is not verified');
  }
  const rawName = payload.name?.trim();
  return {
    email: payload.email,
    name: rawName ? rawName : (payload.email.split('@')[0] ?? payload.email),
  };
}
