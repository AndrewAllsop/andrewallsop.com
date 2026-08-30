/** Sends the notification email through the Resend HTTP API. */

import { headerSafe, type Submission } from './validate';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailConfig {
  apiKey: string;
  fromAddress: string;
  fromName: string;
  toAddress: string;
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

function buildBody(submission: Submission): string {
  const { name, email, topic, message } = submission;

  return [
    'New message from the andrewallsop.com contact form.',
    '',
    `Name:  ${headerSafe(name)}`,
    `Email: ${email}`,
    `Topic: ${headerSafe(topic) || '(not specified)'}`,
    '',
    '---',
    '',
    message,
  ].join('\n');
}

/** The display name is quoted so dots in FROM_NAME stay RFC 5322 valid. */
function formatSender(config: EmailConfig): string {
  const name = config.fromName.replace(/["\\]/g, '');
  return `"${name}" <${config.fromAddress}>`;
}

export async function sendSubmission(config: EmailConfig, submission: Submission): Promise<void> {
  const subject = headerSafe(
    `[Contact] ${submission.topic || 'Website enquiry'} — ${submission.name}`
  );

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: formatSender(config),
      to: [config.toAddress],
      // Replying in the mail client goes straight back to the sender.
      reply_to: submission.email,
      subject,
      text: buildBody(submission),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new EmailSendError(`Resend responded ${response.status}: ${detail.slice(0, 300)}`);
  }
}
