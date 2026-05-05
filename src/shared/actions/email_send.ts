// Action: email_send — outbound mail via SMTP (single account).

export interface EmailSendInput {
  to: string;
  subject: string;
  body: string;
  /** Optional reply-to header. */
  replyTo?: string;
}

export interface EmailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export interface EmailSenderConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Default from address (defaults to user). */
  from?: string;
  secure?: boolean;
}

export interface EmailSender {
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export function createEmailSender(config: EmailSenderConfig): EmailSender {
  return {
    async send(input) {
      const nodemailer = await import('nodemailer') as typeof import('nodemailer');
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure ?? true,
        auth: { user: config.user, pass: config.pass },
      });
      const info = await transport.sendMail({
        from: config.from ?? config.user,
        to: input.to,
        subject: input.subject,
        text: input.body,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      });
      return {
        messageId: info.messageId ?? '',
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
      };
    },
  };
}

export function createMockEmailSender(): EmailSender {
  return {
    async send(input) {
      return { messageId: `mock-${Date.now()}`, accepted: [input.to], rejected: [] };
    },
  };
}
