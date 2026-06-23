function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWelcomeUserEmail({
  name,
  email,
  roleName,
  appUrl,
  setupUrl,
  expiresText = '1 hour'
}) {
  const safeName = escapeHtml(name || 'there');
  const safeEmail = escapeHtml(email);
  const safeRole = escapeHtml(roleName || 'Not assigned');
  const safeAppUrl = escapeHtml(appUrl);
  const safeSetupUrl = escapeHtml(setupUrl);
  const safeExpiresText = escapeHtml(expiresText);

  const subject = 'Welcome to SaaSRAY CRM \u2013 Set Up Your Account';
  const text = [
    `Hello ${name || 'there'},`,
    '',
    'Welcome to SaaSRAY CRM. Your account has been created.',
    '',
    `Full Name: ${name || ''}`,
    `Email Address: ${email || ''}`,
    `Assigned Role: ${roleName || 'Not assigned'}`,
    `Application Login URL: ${appUrl}`,
    '',
    `Verify Account & Create Password: ${setupUrl}`,
    '',
    'First login steps:',
    '1. Open the setup link above.',
    '2. Verify your account details.',
    '3. Create a strong password.',
    '4. Return to the SaaSRAY CRM login page.',
    '5. Sign in with your email and new password.',
    '6. Confirm your profile details.',
    '7. Start using your assigned CRM workspace.',
    '',
    'Password: Not yet created - you create it during setup.',
    '',
    `This setup link is unique, expires in ${expiresText}, and can be used only once.`
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,'Segoe UI',sans-serif;color:#172033">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f6fb;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #d9e2ef;border-radius:18px;overflow:hidden">
          <tr>
            <td style="padding:28px 36px;background:#071a33;color:#ffffff;text-align:center">
              <div style="font-size:26px;font-weight:800;letter-spacing:-0.4px">SaaSRAY <span style="color:#35b779">CRM</span></div>
              <div style="font-size:11px;letter-spacing:1.5px;color:#a9b7c8;margin-top:6px">THINK DIGITAL. BUILD SMART.</div>
            </td>
          </tr>

          <tr>
            <td style="padding:34px 36px 22px">
              <p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#4c5d75">Hello ${safeName},</p>
              <h1 style="font-size:24px;line-height:1.25;margin:0 0 14px;color:#0b1220">Welcome to SaaSRAY CRM</h1>
              <p style="font-size:15px;line-height:1.7;margin:0;color:#4c5d75">
                Your CRM portal account has been created. Verify your account and create your password to get started.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 36px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e1e7f0;border-radius:12px;overflow:hidden">
                <tr>
                  <td colspan="2" style="background:#f7f9fc;padding:12px 16px;font-size:12px;font-weight:700;color:#6b7c93;text-transform:uppercase;letter-spacing:.08em">Account Details</td>
                </tr>
                <tr><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#6b7c93;font-size:13px">Full Name</td><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#172033;font-size:13px;font-weight:700">${safeName}</td></tr>
                <tr><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#6b7c93;font-size:13px">Email Address</td><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#172033;font-size:13px;font-weight:700">${safeEmail}</td></tr>
                <tr><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#6b7c93;font-size:13px">Assigned Role</td><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#172033;font-size:13px;font-weight:700">${safeRole}</td></tr>
                <tr><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#6b7c93;font-size:13px">Application URL</td><td style="padding:12px 16px;border-top:1px solid #e1e7f0;color:#0176d3;font-size:13px;font-weight:700">${safeAppUrl}</td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:2px 36px 26px">
              <a href="${safeSetupUrl}" style="display:inline-block;background:#0176d3;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:15px 28px;border-radius:10px">Verify Account &amp; Create Password</a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 36px 26px">
              <p style="font-size:12px;line-height:1.6;margin:0 0 8px;color:#6b7c93">If the button does not work, copy and paste this link into your browser:</p>
              <p style="font-size:12px;line-height:1.6;margin:0;color:#0176d3;word-break:break-all">${safeSetupUrl}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 36px 26px">
              <h2 style="font-size:16px;margin:0 0 12px;color:#0b1220">First Login Steps</h2>
              <ol style="margin:0;padding-left:20px;color:#4c5d75;font-size:14px;line-height:1.8">
                <li>Open the secure setup link.</li>
                <li>Confirm your account details.</li>
                <li>Create a strong password.</li>
                <li>Return to the SaaSRAY CRM login page.</li>
                <li>Sign in with your email and new password.</li>
                <li>Review your profile information.</li>
                <li>Start using your assigned CRM workspace.</li>
              </ol>
            </td>
          </tr>

          <tr>
            <td style="padding:0 36px 26px">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:12px">
                <tr><td style="padding:16px">
                  <p style="font-size:13px;margin:0 0 8px;color:#0b1220;font-weight:800">Login Information</p>
                  <p style="font-size:13px;margin:0 0 4px;color:#4c5d75">Application URL: <strong style="color:#172033">${safeAppUrl}</strong></p>
                  <p style="font-size:13px;margin:0 0 4px;color:#4c5d75">User Email: <strong style="color:#172033">${safeEmail}</strong></p>
                  <p style="font-size:13px;margin:0;color:#4c5d75">Password: <strong style="color:#172033">Not yet created - user creates it during setup.</strong></p>
                </td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 36px 32px">
              <div style="background:#fff8e6;border:1px solid #f3d27b;border-radius:12px;padding:16px">
                <p style="font-size:13px;margin:0;color:#7a4b00;line-height:1.7">
                  <strong>Security note:</strong> This setup link is unique, expires in ${safeExpiresText}, and can be used only once.
                  Never share your password. If you did not expect this invitation, ignore this email or contact your SaaSRAY CRM administrator.
                </p>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 36px;background:#f7f9fc;border-top:1px solid #e1e7f0;text-align:center">
              <p style="font-size:12px;line-height:1.6;margin:0;color:#6b7c93">Need help? Contact your SaaSRAY CRM administrator.</p>
              <p style="font-size:11px;line-height:1.6;margin:8px 0 0;color:#8a98aa">SaaSRAY CRM &bull; This email was sent to ${safeEmail}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { renderWelcomeUserEmail };
