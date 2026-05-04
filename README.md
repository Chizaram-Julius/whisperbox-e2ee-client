# WhisperBox E2EE Client

WhisperBox encrypts message content in the browser before it is sent to https://whisperbox.koyeb.app, so the backend receives only encrypted blobs.

GitHub repo: `https://github.com/Chizaram-Julius/whisperbox-e2ee-client`

API docs: `https://whisperbox.koyeb.app/docs#`

## Stack

- React for the client-side messaging UI.
- TypeScript for typed API contracts, encrypted payloads, and safer crypto/session handling.
- Vite for local development, production builds, and the `/api` proxy to the WhisperBox backend.
- Tailwind CSS for responsive auth, chat, loading, empty, and error states.
- Web Crypto API for all client-side cryptography: RSA-OAEP 2048, PBKDF2, AES-KW, and AES-GCM.
- IndexedDB for persisted session continuity without storing plaintext private keys.
- WhisperBox HTTPS API and WSS channel at `https://whisperbox.koyeb.app`.
- `lucide-react` for clear security, status, search, and messaging icons.

## Architecture

```text
React UI
  | auth forms, chat shell, search, message bubbles
  v
src/lib/crypto.ts
  | RSA-OAEP, PBKDF2, AES-KW, AES-GCM, base64 helpers
  v
src/lib/api.ts  <---->  WhisperBox HTTPS API
src/lib/websocket.ts <-> WhisperBox WSS realtime channel
  ^
  |
src/lib/storage.ts
  | IndexedDB session, tokens, profile, wrapped key only
```

## Project Structure

```text
.
|-- src/
|   |-- App.tsx
|   |   Auth state, registration/login flow, private-key unlock, logout, and session routing.
|   |-- main.tsx
|   |   React entry point.
|   |-- styles.css
|   |   Tailwind base styles and app theme tokens.
|   |-- types/
|   |   |-- api.ts
|   |       WhisperBox API, WebSocket, encrypted payload, and decrypted message types.
|   |-- lib/
|   |   |-- api.ts
|   |   |   HTTPS integration for auth, refresh, users, conversations, history, and REST fallback send.
|   |   |-- crypto.ts
|   |   |   Web Crypto key generation, PBKDF2 wrapping, AES-GCM encryption, RSA key exchange, and decryption.
|   |   |-- storage.ts
|   |   |   IndexedDB session storage for tokens, profile, public key, salt, and wrapped private-key blob.
|   |   |-- websocket.ts
|   |       Real-time `message.send` and `message.receive` handling over WSS.
|   |-- components/
|       |-- auth/
|       |   |-- AuthPanel.tsx
|       |       Login/register UI with input validation and key-generation handoff.
|       |-- chat/
|       |   |-- ChatShell.tsx
|       |       Conversations, user search, encryption before send, local decryption after receive, and error states.
|       |-- layout/
|       |   |-- TopBar.tsx
|       |       Session identity, encrypted status, WebSocket status, and logout action.
|       |-- ui/
|           |-- Button.tsx
|           |-- Input.tsx
|           Shared accessible form controls.
|-- vite.config.ts
|   Vite config with `/api` proxy to `https://whisperbox.koyeb.app`.
|-- tailwind.config.ts
|   Tailwind theme configuration.
|-- package.json
|   Scripts and dependencies.
|-- README.md
    Stage 4B architecture, encryption flow, key management, trade-offs, and testing notes.
```

## Encryption Flow

Registration generates a 2048-bit RSA-OAEP key pair in the browser. The public key is exported as base64. The private key is wrapped with an AES-KW key derived from the user password and a random 128-bit PBKDF2 salt, then only the wrapped private key is sent to the backend. After wrapping, the app re-imports the private key as non-extractable before opening the chat session.

Login receives `wrapped_private_key` and `pbkdf2_salt`, derives the same AES-KW key from the entered password, and unwraps the RSA private key into memory. If unwrap fails, the UI reports that the private key could not be unlocked.

Sending a message generates a fresh AES-GCM 256-bit key and 96-bit IV. The plaintext is encrypted locally. The AES key is encrypted with the recipient public key as `encryptedKey` and with the sender public key as `encryptedKeyForSelf`. Only `{ ciphertext, iv, encryptedKey, encryptedKeyForSelf }` is sent through WebSocket `message.send` or `POST /messages` fallback.

Receiving and history loading decrypt the relevant encrypted AES key with the in-memory RSA private key, then decrypt the ciphertext with AES-GCM. Failed decryptions render a placeholder instead of crashing.

## Key Management

- Plaintext private keys are never stored in `localStorage`, `sessionStorage`, or IndexedDB.
- The raw RSA private key exists only as a non-extractable `CryptoKey` in memory after registration, login, or unlock.
- IndexedDB stores the access token, refresh token, user profile, PBKDF2 salt, public key, and wrapped private key for demo session continuity.
- Access tokens are refreshed before expiry using `POST /auth/refresh`.
- Logout calls `POST /auth/logout`, clears IndexedDB, and drops the in-memory token/private key.

## API Integration

Base URL: `https://whisperbox.koyeb.app`

Implemented endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /users/search?q=`
- `GET /users/{userId}/public-key`
- `GET /conversations`
- `GET /conversations/{userId}/messages`
- `POST /messages`
- `wss://whisperbox.koyeb.app/ws?token=<access_token>`

## Security Trade-Offs

- Browser apps cannot fully protect tokens from XSS, so this frontend keeps dependencies small and stores no plaintext private key.
- Refresh tokens are persisted in IndexedDB for demo usability. A production app should combine hardened CSP, strict dependency control, httpOnly cookies where supported by the backend, and device-level protections.
- The app does not implement message authentication beyond AES-GCM integrity and server auth.
- Replay attack prevention is limited by the backend protocol. The client de-duplicates repeated WebSocket message ids during a live session, but it does not maintain a signed monotonic message counter that would detect every replay with a new server id.
- Forward secrecy is not implemented. Long-term RSA keys protect per-message AES keys; compromise of a user private key can expose historical encrypted AES keys.

## Run Locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. Web Crypto API requires HTTPS or `localhost`; Vite on localhost is supported.

Local development uses Vite's `/api` proxy to avoid browser CORS blocks while still calling the real WhisperBox backend. In production, the app uses `https://whisperbox.koyeb.app` directly unless `VITE_API_BASE_URL` is set. WebSocket traffic uses `wss://whisperbox.koyeb.app` unless `VITE_WS_BASE_URL` is set.

## Manual E2EE Test

1. Register user A with a strong password.
2. Logout, then register user B in another browser profile or private window.
3. Search for user A from user B.
4. Send a message.
5. Confirm the message appears in user A after WebSocket delivery or refresh.
6. Open DevTools Network and verify no plaintext message body is sent. The payload should contain only `ciphertext`, `iv`, `encryptedKey`, and `encryptedKeyForSelf`.
7. Reload the app. Enter the account password to unwrap the private key and decrypt history.
8. Try the wrong password on unlock and confirm the UI fails gracefully.

## HNG Stage 4B Compliance Checklist

- React + TypeScript frontend
- Tailwind CSS styling
- Web Crypto API RSA-OAEP, PBKDF2, AES-KW, AES-GCM
- IndexedDB session handling
- No plaintext private key persistence
- No hardcoded crypto keys
- Register/login/logout/session refresh
- Bearer token protected API calls
- WebSocket realtime messaging with REST fallback
- Client-side decryption for received and historical messages
- Conversations and search
- Responsive auth and chat UI
- Loading, empty, and error states
- README security limitations, replay limitation, and forward secrecy limitation
