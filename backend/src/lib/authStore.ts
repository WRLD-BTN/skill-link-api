// File-backed auth store keeps MVP approval and password flows on the server side instead of in browser storage.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type UserRole = 'client' | 'tradesperson' | 'admin'
type UserStatus = 'Active' | 'Suspended' | 'Flagged'
type JoinRequestStatus = 'Pending' | 'Approved' | 'Rejected'

export interface StoredUser {
  id: string
  fullName: string
  email: string
  phone: string
  suburb: string
  role: UserRole
  status: UserStatus
  registeredAt: string
  passwordHash: string
}

export interface StoredJoinRequest {
  id: string
  fullName: string
  email: string
  phone: string
  suburb: string
  city: string
  primarySkill: string
  yearsExperience: number
  status: JoinRequestStatus
  submittedAt: string
  passwordHash: string
}

interface StoreData {
  users: StoredUser[]
  joinRequests: StoredJoinRequest[]
}

const bootstrapAdminPassword = process.env.VITE_ADMIN_PASSWORD ?? 'skill-l!nk@2026'
const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.runtime')
const storePath = path.join(runtimeDir, 'auth-store.json')

function hashPassword(password: string) {
  return createHash('sha256').update(password.trim()).digest('hex')
}

function makeTimestamp() {
  return new Date().toISOString()
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function seedStore(): StoreData {
  return {
    users: [createBootstrapAdmin()],
    joinRequests: [],
  }
}

function createBootstrapAdmin(): StoredUser {
  return {
    id: 'admin-1',
    fullName: 'Admin User',
    email: 'admin@skilllink.test',
    phone: '+263771111111',
    suburb: 'Avondale',
    role: 'admin',
    status: 'Active',
    registeredAt: '2026-02-01',
    passwordHash: hashPassword(bootstrapAdminPassword),
  }
}

async function ensureStore() {
  await mkdir(runtimeDir, { recursive: true })

  try {
    const content = await readFile(storePath, 'utf8')
    const parsed = JSON.parse(content) as StoreData
    const store = {
      users: parsed.users ?? [],
      joinRequests: parsed.joinRequests ?? [],
    }

    if (!store.users.some((user) => user.role === 'admin')) {
      store.users = [createBootstrapAdmin(), ...store.users]
      await saveStore(store)
    }

    return store
  } catch {
    const seeded = seedStore()
    await writeFile(storePath, JSON.stringify(seeded, null, 2), 'utf8')
    return seeded
  }
}

async function saveStore(store: StoreData) {
  await mkdir(runtimeDir, { recursive: true })
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8')
}

function matchesContact<T extends { email: string; phone: string }>(entry: T, email: string, phone: string) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedPhone = phone.trim()

  return (
    (normalizedEmail.length > 0 && normalizeEmail(entry.email) === normalizedEmail) ||
    (normalizedPhone.length > 0 && entry.phone.trim() === normalizedPhone)
  )
}

export async function listUsers() {
  const store = await ensureStore()
  return store.users
}

export async function listJoinRequests() {
  const store = await ensureStore()
  return store.joinRequests
}

export async function readJoinRequest(id: string) {
  const store = await ensureStore()
  return store.joinRequests.find((request) => request.id === id) ?? null
}

export async function createOrUpdateClient(input: {
  fullName: string
  email: string
  phone: string
  suburb: string
  password: string
}) {
  const store = await ensureStore()
  const existingUser = store.users.find(
    (user) => user.role === 'client' && matchesContact(user, input.email, input.phone),
  )

  const nextUser: StoredUser = existingUser
    ? {
        ...existingUser,
        fullName: input.fullName.trim() || existingUser.fullName,
        email: normalizeEmail(input.email),
        phone: input.phone.trim(),
        suburb: input.suburb.trim() || existingUser.suburb,
        passwordHash: hashPassword(input.password),
      }
    : {
        id: `client-${Date.now()}`,
        fullName: input.fullName.trim() || 'SkillLink Client',
        email: normalizeEmail(input.email),
        phone: input.phone.trim(),
        suburb: input.suburb.trim() || 'Harare',
        role: 'client',
        status: 'Active',
        registeredAt: makeTimestamp().slice(0, 10),
        passwordHash: hashPassword(input.password),
      }

  store.users = existingUser
    ? store.users.map((user) => (user.id === existingUser.id ? nextUser : user))
    : [nextUser, ...store.users]

  await saveStore(store)
  return nextUser
}

export async function authenticateUser(input: {
  email: string
  phone: string
  role: UserRole
  password: string
}) {
  const store = await ensureStore()
  const user = store.users.find((entry) => entry.role === input.role && matchesContact(entry, input.email, input.phone))

  if (!user) {
    return { ok: false as const, message: 'Account not found.' }
  }

  if (user.status === 'Suspended') {
    return { ok: false as const, message: 'This account is currently suspended.' }
  }

  if (user.passwordHash !== hashPassword(input.password)) {
    return { ok: false as const, message: `${input.role === 'admin' ? 'Admin' : 'Account'} password is incorrect.` }
  }

  return {
    ok: true as const,
    user: {
      name: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      suburb: user.suburb,
    },
  }
}

export async function submitTradespersonRequest(input: {
  fullName: string
  email: string
  phone: string
  suburb: string
  city: string
  primarySkill: string
  yearsExperience: number
  password: string
}) {
  const store = await ensureStore()
  const existingRequest = store.joinRequests.find((request) => matchesContact(request, input.email, input.phone))
  const submittedAt = makeTimestamp()
  const nextRequest: StoredJoinRequest = existingRequest
    ? {
        ...existingRequest,
        ...input,
        email: normalizeEmail(input.email),
        phone: input.phone.trim(),
        suburb: input.suburb.trim(),
        city: input.city.trim(),
        passwordHash: hashPassword(input.password),
        status: 'Pending',
        submittedAt,
      }
    : {
        id: `request-${Date.now()}`,
        fullName: input.fullName.trim(),
        email: normalizeEmail(input.email),
        phone: input.phone.trim(),
        suburb: input.suburb.trim(),
        city: input.city.trim(),
        primarySkill: input.primarySkill.trim(),
        yearsExperience: input.yearsExperience,
        status: 'Pending',
        submittedAt,
        passwordHash: hashPassword(input.password),
      }

  store.joinRequests = existingRequest
    ? [nextRequest, ...store.joinRequests.filter((request) => request.id !== existingRequest.id)]
    : [nextRequest, ...store.joinRequests]

  await saveStore(store)
  return nextRequest
}

export async function readTradespersonStatus(input: { email: string; phone: string }) {
  const store = await ensureStore()
  const approvedUser = store.users.find(
    (user) => user.role === 'tradesperson' && matchesContact(user, input.email, input.phone),
  )

  if (approvedUser) {
    return {
      status: 'Approved' as const,
      fullName: approvedUser.fullName,
      suburb: approvedUser.suburb,
      email: approvedUser.email,
      phone: approvedUser.phone,
    }
  }

  const request = store.joinRequests.find((entry) => matchesContact(entry, input.email, input.phone))

  if (!request) {
    return null
  }

  return {
    status: request.status,
    fullName: request.fullName,
    suburb: request.suburb,
    city: request.city,
    primarySkill: request.primarySkill,
    submittedAt: request.submittedAt,
    email: request.email,
    phone: request.phone,
  }
}

export async function updateJoinRequest(id: string, status: JoinRequestStatus) {
  const store = await ensureStore()
  const request = store.joinRequests.find((entry) => entry.id === id)

  if (!request) {
    return null
  }

  request.status = status

  if (status === 'Approved') {
    const existingUser = store.users.find(
      (user) => user.role === 'tradesperson' && matchesContact(user, request.email, request.phone),
    )

    const approvedUser: StoredUser = existingUser
      ? {
          ...existingUser,
          fullName: request.fullName,
          email: normalizeEmail(request.email),
          phone: request.phone.trim(),
          suburb: request.suburb.trim(),
          role: 'tradesperson',
          status: 'Active',
          passwordHash: request.passwordHash,
        }
      : {
          id: `tradesperson-${Date.now()}`,
          fullName: request.fullName,
          email: normalizeEmail(request.email),
          phone: request.phone.trim(),
          suburb: request.suburb.trim(),
          role: 'tradesperson',
          status: 'Active',
          registeredAt: makeTimestamp().slice(0, 10),
          passwordHash: request.passwordHash,
        }

    store.users = existingUser
      ? store.users.map((user) => (user.id === existingUser.id ? approvedUser : user))
      : [approvedUser, ...store.users]
  }

  await saveStore(store)
  return request
}

export async function updateUserStatus(id: string, status: UserStatus) {
  const store = await ensureStore()
  const user = store.users.find((entry) => entry.id === id)

  if (!user) {
    return null
  }

  user.status = status
  await saveStore(store)
  return user
}

export async function removeUser(id: string) {
  const store = await ensureStore()
  const user = store.users.find((entry) => entry.id === id)

  if (!user || user.role === 'admin') {
    return false
  }

  const before = store.users.length
  store.users = store.users.filter((entry) => entry.id !== id)
  await saveStore(store)
  return before !== store.users.length
}

export async function changeAdminPassword(input: {
  email: string
  originalAdminPassword: string
  newPassword: string
}) {
  const store = await ensureStore()
  const admin = store.users.find((user) => user.role === 'admin' && normalizeEmail(user.email) === normalizeEmail(input.email))

  if (!admin) {
    return { ok: false as const, message: 'Admin account not found.' }
  }

  if (hashPassword(input.originalAdminPassword) !== hashPassword(bootstrapAdminPassword)) {
    return { ok: false as const, message: 'Enter the original SkillLink admin password to continue.' }
  }

  admin.passwordHash = hashPassword(input.newPassword)
  await saveStore(store)
  return { ok: true as const, message: 'Your admin password has been updated on the server.' }
}
