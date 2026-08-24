import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { validateSession } from '@/lib/redis';

// ★ JWT Secret — Production'da eksikse BAŞLATMA
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('KRİTİK: JWT_SECRET environment variable tanımlı değil! Uygulama başlatılamaz.');
  }
  if (!secret) {
    console.warn('⚠️ JWT_SECRET tanımlı değil — dev-only fallback kullanılıyor');
    return 'dev-secret-change-me';
  }
  return secret;
}
const JWT_SECRET = getJwtSecret();

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
}

/**
 * JWT + Session doğrulaması
 * Her korumalı API route'ta çağrılır
 */
export async function verifyAuth(request: Request): Promise<AuthPayload | null> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;

    // Dev-mode: Redis olmadan çalış
    if (payload.sessionId === 'dev-session' && process.env.NODE_ENV !== 'production') {
      return payload;
    }

    // Session hâlâ geçerli mi? (logout all devices kontrolü)
    try {
      const sessionValid = await validateSession(payload.userId, payload.sessionId);
      if (!sessionValid) {
        return null;
      }
    } catch {
      // Redis bağlantı hatası — dev modda devam et
      if (process.env.NODE_ENV !== 'production') return payload;
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Admin rolü kontrolü
 */
export function requireAdmin(payload: AuthPayload): boolean {
  return payload.role === 'admin' || payload.role === 'super_admin';
}

/**
 * Super admin rolü kontrolü
 */
export function requireSuperAdmin(payload: AuthPayload): boolean {
  return payload.role === 'super_admin';
}

/**
 * Auth middleware — korumalı route'lar için
 */
export async function withAuth(
  request: Request,
  handler: (payload: AuthPayload) => Promise<NextResponse>
): Promise<NextResponse> {
  const payload = await verifyAuth(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'Yetkilendirme gerekli' },
      { status: 401 }
    );
  }
  return handler(payload);
}

/**
 * Admin middleware — sadece admin'ler için
 */
export async function withAdmin(
  request: Request,
  handler: (payload: AuthPayload) => Promise<NextResponse>
): Promise<NextResponse> {
  const payload = await verifyAuth(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'Yetkilendirme gerekli' },
      { status: 401 }
    );
  }
  if (!requireAdmin(payload)) {
    return NextResponse.json(
      { error: 'Admin yetkisi gerekli' },
      { status: 403 }
    );
  }
  return handler(payload);
}

/**
 * Registrar middleware — kayıt merkezi + admin'ler için
 */
export function requireRegistrar(payload: AuthPayload): boolean {
  return ['registrar', 'admin', 'super_admin'].includes(payload.role);
}

export async function withRegistrar(
  request: Request,
  handler: (payload: AuthPayload) => Promise<NextResponse>
): Promise<NextResponse> {
  const payload = await verifyAuth(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'Yetkilendirme gerekli' },
      { status: 401 }
    );
  }
  if (!requireRegistrar(payload)) {
    return NextResponse.json(
      { error: 'Kayıt Merkezi yetkisi gerekli' },
      { status: 403 }
    );
  }
  return handler(payload);
}
