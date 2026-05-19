// Express server entry point that exposes demo catalog APIs plus server-backed auth and approval routes.
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { jobs, skills, tradespeople } from './data/mock.js'
import {
  authenticateUser,
  changeAdminPassword,
  createOrUpdateClient,
  listJoinRequests,
  listUsers,
  readJoinRequest,
  readTradespersonStatus,
  removeUser,
  submitTradespersonRequest,
  updateJoinRequest,
  updateUserStatus,
} from './lib/authStore.js'
import { sendVerificationSms } from './lib/africasTalking.js'
import { createOtp, verifyOtp } from './lib/otpStore.js'
import { normalizeZimbabwePhone } from './lib/phone.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 4000)

app.use(cors())
app.use(express.json())

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'skilllink-api' })
})

app.get('/api/skills', (_request, response) => {
  response.json(skills)
})

app.get('/api/tradespeople', (request, response) => {
  const skill = String(request.query.skill ?? '').toLowerCase()
  const suburb = String(request.query.suburb ?? '').toLowerCase()

  const filtered = tradespeople.filter((person) => {
    const matchesSkill =
      skill.length === 0 ||
      person.skillIds.some((skillId) =>
        skills.find((entry) => entry.id === skillId)?.name.toLowerCase().includes(skill),
      )
    const matchesSuburb = suburb.length === 0 || person.suburb.toLowerCase().includes(suburb)

    return matchesSkill && matchesSuburb
  })

  response.json(filtered)
})

app.get('/api/jobs', (request, response) => {
  const skill = String(request.query.skill ?? '').toLowerCase()
  const suburb = String(request.query.suburb ?? '').toLowerCase()

  const filtered = jobs.filter((job) => {
    const skillName = skills.find((entry) => entry.id === job.skillId)?.name.toLowerCase() ?? ''
    const matchesSkill = skill.length === 0 || skillName.includes(skill)
    const matchesSuburb = suburb.length === 0 || job.suburb.toLowerCase().includes(suburb)

    return matchesSkill && matchesSuburb
  })

  response.json(filtered)
})

app.post('/api/auth/access', async (request, response) => {
  const mode = String(request.body?.mode ?? 'signin')
  const role = String(request.body?.role ?? 'client')
  const email = String(request.body?.email ?? '').trim().toLowerCase()
  const phone = normalizeZimbabwePhone(String(request.body?.phone ?? '')) ?? String(request.body?.phone ?? '').trim()
  const password = String(request.body?.password ?? '')
  const name = String(request.body?.name ?? '')
  const suburb = String(request.body?.suburb ?? '')

  if (!email) {
    response.status(400).json({ ok: false, message: 'Email is required.' })
    return
  }

  if (password.trim().length < 4) {
    response.status(400).json({ ok: false, message: 'Password must be at least 4 characters.' })
    return
  }

  if (role === 'client' && mode === 'create') {
    const user = await createOrUpdateClient({
      fullName: name,
      email,
      phone,
      suburb,
      password,
    })

    response.json({
      ok: true,
      user: {
        name: user.fullName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        suburb: user.suburb,
      },
    })
    return
  }

  if (role === 'tradesperson') {
    const status = await readTradespersonStatus({ email, phone })

    if (!status || status.status !== 'Approved') {
      response.status(403).json({
        ok: false,
        requiresApproval: true,
        status: status?.status ?? 'Pending',
        message:
          status?.status === 'Rejected'
            ? 'Your request was rejected. You can update your details and submit again.'
            : 'Your tradesperson account is waiting for admin approval.',
      })
      return
    }
  }

  const result = await authenticateUser({
    email,
    phone,
    role: role as 'client' | 'tradesperson' | 'admin',
    password,
  })

  response.status(result.ok ? 200 : 403).json(result)
})

app.post('/api/auth/tradesperson-request', async (request, response) => {
  const phone = normalizeZimbabwePhone(String(request.body?.phone ?? ''))

  if (!phone) {
    response.status(400).json({ ok: false, message: 'Enter a valid Zimbabwean phone number.' })
    return
  }

  const nextRequest = await submitTradespersonRequest({
    fullName: String(request.body?.fullName ?? '').trim(),
    email: String(request.body?.email ?? '').trim().toLowerCase(),
    phone,
    suburb: String(request.body?.suburb ?? '').trim(),
    city: String(request.body?.city ?? 'Harare').trim(),
    primarySkill: String(request.body?.primarySkill ?? '').trim(),
    yearsExperience: Number(request.body?.yearsExperience ?? 0),
    password: String(request.body?.password ?? ''),
  })

  response.json({
    ok: true,
    request: nextRequest,
    message: 'Join request sent to admin.',
  })
})

app.get('/api/auth/tradesperson-status', async (request, response) => {
  const email = String(request.query.email ?? '').trim().toLowerCase()
  const phone = normalizeZimbabwePhone(String(request.query.phone ?? '')) ?? String(request.query.phone ?? '').trim()

  if (!email && !phone) {
    response.status(400).json({ ok: false, message: 'Provide an email or phone number.' })
    return
  }

  const status = await readTradespersonStatus({ email, phone })

  if (!status) {
    response.status(404).json({ ok: false, message: 'No tradesperson request found.' })
    return
  }

  response.json({ ok: true, status })
})

app.get('/api/admin/users', async (_request, response) => {
  response.json(await listUsers())
})

app.patch('/api/admin/users/:id/status', async (request, response) => {
  const user = await updateUserStatus(String(request.params.id), String(request.body?.status ?? 'Active') as 'Active' | 'Suspended' | 'Flagged')

  if (!user) {
    response.status(404).json({ ok: false, message: 'User not found.' })
    return
  }

  response.json({ ok: true, user })
})

app.delete('/api/admin/users/:id', async (request, response) => {
  const removed = await removeUser(String(request.params.id))
  response.status(removed ? 200 : 404).json({ ok: removed })
})

app.get('/api/admin/requests', async (_request, response) => {
  response.json(await listJoinRequests())
})

app.get('/api/admin/requests/:id', async (request, response) => {
  const joinRequest = await readJoinRequest(String(request.params.id))

  if (!joinRequest) {
    response.status(404).json({ ok: false, message: 'Request not found.' })
    return
  }

  response.json({ ok: true, request: joinRequest })
})

app.post('/api/admin/requests/:id/status', async (request, response) => {
  const nextRequest = await updateJoinRequest(
    String(request.params.id),
    String(request.body?.status ?? 'Pending') as 'Pending' | 'Approved' | 'Rejected',
  )

  if (!nextRequest) {
    response.status(404).json({ ok: false, message: 'Request not found.' })
    return
  }

  response.json({ ok: true, request: nextRequest })
})

app.post('/api/admin/change-password', async (request, response) => {
  const result = await changeAdminPassword({
    email: String(request.body?.email ?? ''),
    originalAdminPassword: String(request.body?.originalAdminPassword ?? ''),
    newPassword: String(request.body?.newPassword ?? ''),
  })

  response.status(result.ok ? 200 : 400).json(result)
})

app.post('/api/auth/request-otp', async (request, response) => {
  const phone = normalizeZimbabwePhone(String(request.body?.phone ?? ''))

  if (!phone) {
    response.status(400).json({ message: 'Enter a valid Zimbabwean phone number.' })
    return
  }

  try {
    const code = createOtp(phone)
    const result = await sendVerificationSms(phone, code)

    response.json({
      message: result.simulated ? 'Verification code generated for development.' : 'Verification code sent.',
      ...(result.simulated && process.env.NODE_ENV !== 'production' ? { debugCode: code } : {}),
    })
  } catch (error) {
    response.status(502).json({
      message: 'Unable to send verification SMS right now.',
      detail: error instanceof Error ? error.message : 'Unknown SMS provider error.',
    })
  }
})

app.post('/api/auth/verify-otp', (request, response) => {
  const phone = normalizeZimbabwePhone(String(request.body?.phone ?? ''))
  const code = String(request.body?.code ?? '').trim()

  if (!phone) {
    response.status(400).json({ message: 'Enter a valid Zimbabwean phone number.' })
    return
  }

  if (!code) {
    response.status(400).json({ message: 'Enter the verification code.' })
    return
  }

  const result = verifyOtp(phone, code)

  if (!result.ok) {
    response.status(400).json(result)
    return
  }

  response.json(result)
})

app.listen(port, () => {
  console.log(`SkillLink API listening on http://localhost:${port}`)
})
