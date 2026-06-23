const { Resend } = require('resend');
const { renderWelcomeUserEmail } = require('./templates/welcome-user');

const resend = new Resend(process.env.RESEND_API_KEY);

function getFromEmail() {
  return process.env.FROM_EMAIL || 'SaaSRAY CRM <noreply@crm.saasray.com>';
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const result = await resend.emails.send({
    from: getFromEmail(),
    to,
    subject,
    html,
    text
  });

  if (result?.error) {
    throw new Error(result.error.message || 'Email provider rejected the message');
  }

  return result?.data || result;
}

async function sendWelcomeUserInvitation(payload) {
  const message = renderWelcomeUserEmail(payload);
  return sendEmail({
    to: payload.email,
    subject: message.subject,
    html: message.html,
    text: message.text
  });
}

module.exports = {
  sendEmail,
  sendWelcomeUserInvitation
};
