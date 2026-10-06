import { createHmac } from 'crypto'

export function computeCognitoSecretHash(
  username: string,
  clientId: string,
  clientSecret: string
): string {
  return createHmac('sha256', clientSecret)
    .update(`${username}${clientId}`, 'utf-8')
    .digest('base64')
}
