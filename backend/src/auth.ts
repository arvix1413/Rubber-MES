import { SignJWT, jwtVerify } from 'jose'
import crypto from 'crypto'

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'oms_jwt_secret_2026')

export function hashPw(pw: string): string {
  return crypto.createHash('sha256').update(pw).digest('hex')
}

export async function signJwt(payload: object): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyJwt(token: string): Promise<any> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload
  } catch {
    return null
  }
}

export function now8(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
