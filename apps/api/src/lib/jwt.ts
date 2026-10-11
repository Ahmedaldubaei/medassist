import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface TokenPayload {
  sub: string;
  role: string;
  /**
   * Session version (H5): must match User.tokenVersion at request time.
   * Bumped on password reset/change and account deletion so previously
   * issued tokens stop working. Absent in pre-H5 tokens → treated as 0,
   * which matches the DB default for existing users.
   */
  tv: number;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET);
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Invalid token payload');
  }
  const tv = decoded.tv;
  return {
    sub: decoded.sub as string,
    role: decoded.role as string,
    tv: typeof tv === 'number' && Number.isInteger(tv) && tv >= 0 ? tv : 0,
  };
}
