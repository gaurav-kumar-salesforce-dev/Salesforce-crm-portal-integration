# Salesforce-crm-portal-integration
For Crm Portal integration

## Multi-org Salesforce setup

The app still supports the original single-org `.env` values:

```env
SF_CLIENT_ID=...
SF_CLIENT_SECRET=...
SF_LOGIN_URL=https://login.salesforce.com
SF_INSTANCE_URL=https://your-domain.my.salesforce.com
SF_REDIRECT_URI=http://localhost:3000/oauth/callback
```

For additional orgs, open the app and click the org pill in the top-right header. Add a label, key, login type, Connected App client id, and client secret, then choose **Save & Connect**. The browser sends the secret to the server, but the secret is not returned to the browser after saving.

Additional org configurations are stored locally in `sf-orgs.local.json`, which is ignored by git. Each org needs a Salesforce Connected App with:

- Callback URL matching `SF_REDIRECT_URI`, usually `http://localhost:3000/oauth/callback`
- OAuth scopes: `api`, `refresh_token`, and `offline_access`
- Production login URL: `https://login.salesforce.com`
- Sandbox login URL: `https://test.salesforce.com`

When you connect a different org, the server switches the active org, stores that org's refresh token, and all existing CRM routes use the active org. Form/detail layouts already hide configured fields that do not exist in the connected org. List queries also filter configured fields against Salesforce describe metadata so missing fields do not break the page.
