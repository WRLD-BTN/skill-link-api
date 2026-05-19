import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface SmsResult {
  simulated: boolean
}

export async function sendVerificationSms(phone: string, code: string): Promise<SmsResult> {
  const username = process.env.AT_USERNAME
  const apiKey = process.env.AT_API_KEY
  const senderId = process.env.AT_SENDER_ID
  const messagePrefix = process.env.AT_VERIFICATION_MESSAGE ?? 'Your SkillLink verification code is'

  if (!username || !apiKey) {
    return { simulated: true }
  }

  try {
    const AfricasTalking = require('africastalking')({
      username,
      apiKey,
    })

    const sms = AfricasTalking.SMS

    await sms.send({
      to: [phone],
      message: `${messagePrefix} ${code}`,
      senderId: senderId || undefined,
    })

    return { simulated: false }
  } catch (error) {
    throw new Error(`SMS sending failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
