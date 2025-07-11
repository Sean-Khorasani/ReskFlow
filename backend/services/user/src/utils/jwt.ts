import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User } from '@prisma/client';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface RefreshTokenPayload extends TokenPayload {
  sessionId: string;
}

export const generateAccessToken = (user: User): string => {
  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  });
};

export const generateRefreshToken = (user: User, sessionId: string): string => {
  const payload: RefreshTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId
  };

  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn
  });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, config.jwt.secret) as TokenPayload;
  } catch (error) {
    throw new Error('Invalid or expired access token');
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};

export const generateEmailVerificationToken = (userId: string, email: string): string => {
  return jwt.sign({ userId, email, type: 'email-verification' }, config.jwt.secret, {
    expiresIn: '24h'
  });
};

export const generatePasswordResetToken = (userId: string, email: string): string => {
  return jwt.sign({ userId, email, type: 'password-reset' }, config.jwt.secret, {
    expiresIn: '1h'
  });
};

export const verifyEmailToken = (token: string): { userId: string; email: string } => {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as any;
    if (payload.type !== 'email-verification') {
      throw new Error('Invalid token type');
    }
    return { userId: payload.userId, email: payload.email };
  } catch (error) {
    throw new Error('Invalid or expired email verification token');
  }
};

export const verifyPasswordResetToken = (token: string): { userId: string; email: string } => {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as any;
    if (payload.type !== 'password-reset') {
      throw new Error('Invalid token type');
    }
    return { userId: payload.userId, email: payload.email };
  } catch (error) {
    throw new Error('Invalid or expired password reset token');
  }
};