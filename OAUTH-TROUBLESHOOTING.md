# Google Drive OAuth Authentication Guide

## The "App isn't verified" Error

When you see the error **"Tally Backup Client has not completed the Google verification process"**, it means your OAuth consent screen is in **Testing mode**. Here are the solutions:

## Solution 1: Add Test Users (Recommended for Personal Use)

1. **Go to Google Cloud Console**
   - Visit [Google Cloud Console](https://console.cloud.google.com/)
   - Select your project

2. **Navigate to OAuth Consent Screen**
   - Go to "APIs & Services" → "OAuth consent screen"

3. **Add Test Users**
   - Scroll down to "Test users" section
   - Click "ADD USERS"
   - Add your Gmail address
   - Click "SAVE"

4. **Run Authentication Again**
   ```bash
   npm run setup-auth
   ```

## Solution 2: Bypass the Warning (For Personal Projects)

1. **When you see the warning screen:**
   - Click "Advanced" (bottom left)
   - Click "Go to Tally Backup Client (unsafe)"
   - Continue with authorization

2. **This is safe because:**
   - You created the app yourself
   - It only accesses your own Google Drive
   - No data is shared with third parties

## Solution 3: Publish the App (For Production Use)

⚠️ **Only needed if sharing with others**

1. **Complete OAuth Consent Screen**
   - Fill in all required fields
   - Add privacy policy URL (if sharing publicly)
   - Add authorized domains

2. **Submit for Verification**
   - Click "PUBLISH APP"
   - May require Google's verification process
   - Can take several days

## Solution 4: Use Internal User Type (For Organization)

If this is for your organization:

1. **Change User Type**
   - Go to OAuth consent screen
   - Select "Internal" instead of "External"
   - Only users in your organization can access

## Quick Fix Steps

For most personal use cases, follow these steps:

```bash
# 1. Add yourself as test user in Google Cloud Console
# 2. Run the auth setup
npm run setup-auth

# 3. When browser opens and shows warning:
#    - Click "Advanced"
#    - Click "Go to Tally Backup Client (unsafe)"
#    - Continue with normal authorization
```

## Common Issues and Solutions

### "access_denied" Error
- **Cause**: Clicked "Cancel" or app isn't approved
- **Solution**: Add email as test user, try again

### "invalid_grant" Error  
- **Cause**: Authorization code expired
- **Solution**: Get a fresh authorization code

### "redirect_uri_mismatch" Error
- **Cause**: Redirect URI in credentials doesn't match
- **Solution**: Check OAuth client configuration

## OAuth Consent Screen Configuration

**Required Fields:**
- App name: "Tally Backup Client" (or your preferred name)
- User support email: Your email
- Developer contact information: Your email

**Scopes Required:**
- `https://www.googleapis.com/auth/drive.file`

## Security Notes

- ✅ This app only accesses files it creates
- ✅ Uses minimal required permissions
- ✅ Tokens are stored locally and encrypted
- ✅ No data sent to third parties

## Still Having Issues?

1. **Check your email is added as test user**
2. **Ensure Google Drive API is enabled**
3. **Verify credentials.json is correct**
4. **Try incognito/private browsing mode**

## Alternative: Service Account (Advanced)

For automated systems without user interaction:

1. Create a Service Account in Google Cloud Console
2. Generate JSON key file
3. Share target Google Drive folder with service account email
4. Modify code to use Service Account authentication

This bypasses OAuth consent but requires manual Drive folder sharing.
