// email_send (T063) — send an email via SMTP / nodemailer.
//
// Per contracts/mcp-local-tools.md. Side-effecting tool: fired only after the substrate's
// discernment gate passes (Principle V: gate POST-call). Outgoing email visible in the
// dashboard transcript with full payload (Principle III).

import nodemailer from 'nodemailer';
import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

export const emailSend: LocalToolFactory = (deps) => ({
  name: 'email_send',
  description: "Send an email from the agent's account.",
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', format: 'email' },
      subject: { type: 'string', minLength: 1, maxLength: 200 },
      body: { type: 'string', minLength: 1, maxLength: 10_000 },
    },
    required: ['to', 'subject', 'body'],
  },
  handler: async (args) => {
    const cfg = deps.env.runnerEmail;
    if (!cfg) {
      return errResult('email_unconfigured');
    }
    const to = typeof args.to === 'string' ? args.to : '';
    const subject = typeof args.subject === 'string' ? args.subject : '';
    const body = typeof args.body === 'string' ? args.body : '';
    if (!to || !subject || !body) return errResult('to/subject/body required');

    const transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });

    try {
      const info = await transporter.sendMail({
        from: cfg.user,
        to,
        subject,
        text: body,
      });
      return okResult({ messageId: info.messageId, sentAt: new Date().toISOString() });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'smtp_failure');
    }
  },
});
