# Google OAuth Setup

This document describes how to configure "Sign in with Google" and "Sign up with Google" for local development and production.

## Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Choose **Web application**
6. Add **Authorized redirect URIs**:
   - Local: `http://localhost:3000/auth/google/callback/signin`, `http://localhost:3000/auth/google/callback/signup`
   - Production: `https://your-api.example.com/auth/google/callback/signin`, `https://your-api.example.com/auth/google/callback/signup`
7. Copy the **Client ID** and **Client secret**

## Environment Variables

### Local development

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI_SIGNIN=http://localhost:3000/auth/google/callback/signin
GOOGLE_REDIRECT_URI_SIGNUP=http://localhost:3000/auth/google/callback/signup
APP_WEB_ORIGIN=http://localhost:5173
```

### Production

Set `APP_WEB_ORIGIN` to your production frontend URL. The OAuth redirect will default to `{APP_WEB_ORIGIN}/#/auth/callback`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI_SIGNIN=https://api.yourdomain.com/auth/google/callback/signin
GOOGLE_REDIRECT_URI_SIGNUP=https://api.yourdomain.com/auth/google/callback/signup
APP_WEB_ORIGIN=https://app.yourdomain.com
# Optional: override the redirect (defaults to https://app.yourdomain.com/#/auth/callback)
# AUTH_SUCCESS_REDIRECT=https://app.yourdomain.com/#/auth/callback
```

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: From Google Console
- `GOOGLE_REDIRECT_URI_*`: Must match exactly what you configured in Google Console (backend URL)
- `APP_WEB_ORIGIN`: **Required when Google OAuth is enabled.** Your frontend origin (local: `http://localhost:5173`, production: `https://your-app.com`)
- `AUTH_SUCCESS_REDIRECT`: Optional. Defaults to `{APP_WEB_ORIGIN}/#/auth/callback` (HashRouter). If your frontend uses BrowserRouter in production, set this to `{APP_WEB_ORIGIN}/auth/callback` instead.
- `SECRET_KEY` or `JWT_SECRET`: Used to sign JWTs (should already exist)

If `GOOGLE_CLIENT_ID` is not set, Google OAuth is disabled. The server starts normally; the sign-in/sign-up pages will show the Google buttons, but clicking them returns 503 (not configured).

## Existing Database (No Migration)

If you have an existing database, run these SQL statements to add the new columns:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
```

### Onboarding Flow (Google Signup)

New users created via Google sign-up are redirected to a 3-step onboarding wizard to select role and plan:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT true;
UPDATE users SET onboarding_completed = true WHERE onboarding_completed IS NULL;
```

## How to Test

1. Start the backend: `npm start` (default port 3000)
2. Start the frontend: `npm run dev` (default port 5173)
3. Ensure `.env` has all required Google variables
4. Go to `http://localhost:5173/signin` or `/signup`
5. Click "Sign in with Google" or "Sign up with Google"
6. Complete the Google consent flow
7. You should be redirected to `/auth/callback` with a token in the hash, then to the app home

## Error Codes (in URL hash)

| Code           | Meaning                                                                 |
|----------------|-------------------------------------------------------------------------|
| `account_exists` | User tried sign-up but account already exists → use sign in instead   |
| `no_account`     | User tried sign-in but no account found → use sign up first           |
| `invalid_state`  | CSRF state mismatch or expired (try again)                             |
| `oauth_failed`   | Token exchange or verification failed                                   |
