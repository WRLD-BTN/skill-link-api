import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface OtpRecord {
  code: string
  expiresAt: number
}

interface OtpStore {
  records: Array<{ phone: string; code: string; expiresAt: number }>
}

const ttlMs = 5 * 60 * 1000
const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.runtime')
const storePath = path.join(runtimeDir, 'otp-store.json')

async function ensureOtpStore(): Promise<OtpStore> {
  await mkdir(runtimeDir, { recursive: true })
  try {
    const content = await readFile(storePath, 'utf8')
    const parsed = JSON.parse(content) as OtpStore
    return { records: parsed.records ?? [] }
  } catch {
    return { records: [] }
  }
}

async function saveOtpStore(store: OtpStore) {
  await mkdir(runtimeDir, { recursive: true })
  const now = Date.now()
  store.records = store.records.filter((r) => r.expiresAt > now)
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8')
}

export async function createOtp(phone: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const store = await ensureOtpStore()
  store.records = store.records.filter((r) => r.phone !== phone)
  store.records.push({
    phone,
    code,
    expiresAt: Date.now() + ttlMs,
  })
  await saveOtpStore(store)
  return code
}

export async function verifyOtp(phone: string, code: string) {
  const store = await ensureOtpStore()
  const entry = store.records.find((r) => r.phone === phone)

  if (!entry) {
    return { ok: false, message: 'No verification code was requested for this phone number.' }
  }

  if (Date.now() > entry.expiresAt) {
    store.records = store.records.filter((r) => r.phone !== phone)
    await saveOtpStore(store)
    return { ok: false, message: 'The verification code has expired. Request a new one.' }
  }

  if (entry.code !== code) {
    return { ok: false, message: 'The verification code is incorrect.' }
  }

  store.records = store.records.filter((r) => r.phone !== phone)
  await saveOtpStore(store)
  return { ok: true, message: 'Phone number verified successfully.' }
}
