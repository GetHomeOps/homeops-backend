# Multi-Factor Authentication (MFA)

TOTP-based MFA using authenticator apps (Google Authenticator, Microsoft Authenticator, Authy).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MFA_ENCRYPTION_KEY` | Yes (production) | 32-byte key (hex or base64) for AES-256-GCM encryption of TOTP secrets. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MFA_ENCRYPTION_KEY_ID` | No | Reserved for future key rotation support. |
| `APP_NAME` | No | Issuer name shown in authenticator apps (default: HomeOps). |

## Database Setup

Run the migration:

```bash
psql $DATABASE_URL -f migrations/007_add_mfa_tables.sql
```

Or ensure your schema includes:
- `users`: `mfa_enabled`, `mfa_secret_encrypted`, `mfa_enrolled_at`
- `mfa_backup_codes`: `user_id`, `code_hash`, `used_at`
- `mfa_enrollment_temp`: `user_id`, `secret_encrypted`, `expires_at`

## API Endpoints

### Authenticated (JWT)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mfa/status` | Returns `{ mfaEnabled, backupCodesRemaining }` |
| POST | `/mfa/setup` | Start enrollment. Returns `{ otpauthUrl, qrCodeDataUrl, manualCode }`. 409 if already enabled. |
| POST | `/mfa/confirm` | Body: `{ token }`. Verify 6-digit code, promote temp secret, return backup codes. |
| POST | `/mfa/disable` | Body: `{ codeOrBackupCode }` or `{ password }`. Disable MFA. |
| POST | `/mfa/backup/regenerate` | Body: `{ code }`. Regenerate backup codes (requires TOTP). |

### Login Flow

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/token` | Login. If user has MFA: returns `{ mfaRequired: true, mfaTicket, mfaPendingToken }` instead of tokens. |
| POST | `/auth/mfa/verify` | Headers: `Authorization: Bearer <mfaTicket>`. Body: `{ codeOrBackupCode }` or `{ tokenOrBackupCode }`. Returns `{ accessToken, refreshToken }` on success. |

## Recovery Flow

1. **Lost authenticator**: Use a backup code at login.
2. **No backup codes**: Contact support if account recovery is needed.
3. **Restart setup**: If enrollment expires or is cancelled, call `/mfa/setup` again to regenerate.

## Security

- TOTP secrets encrypted at rest (AES-256-GCM).
- Backup codes hashed (SHA-256); plaintext shown only once at enrollment.
- MFA verify rate limited: 5 attempts per 5 minutes.
- Auth events logged: `mfa_enabled`, `mfa_disabled`, `mfa_success`, `mfa_failure`.
- Generic error messages ("Invalid code") to avoid leaking info.
