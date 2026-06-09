# TikTok Video Publisher

Publish a video to your TikTok account using a simple web page — just paste a video link and click **Publish**.

No need to download the video to your computer first. This tool fetches the video from the link you provide and sends it to TikTok for you.

---

## What does this tool do?

Think of it like a small website running on your computer that talks to TikTok on your behalf.

1. You **connect your TikTok account** (one-time login).
2. You **paste a public video link** (for example, a link from Amazon S3, your website, or any direct MP4 link).
3. You add a **caption** and choose **who can see the video**.
4. You click **Publish to TikTok** — the video is uploaded and processed by TikTok.

```
You  →  This app (on your computer)  →  TikTok
         downloads video from URL
         uploads it to your account
```

---

## Who is this for?

- **Non-developers** who want to test posting videos to TikTok from a URL.
- **Developers** building or testing TikTok's Content Posting API.

You do **not** need to know how to code to *use* the app once it is set up. The setup steps below do require following instructions carefully (or asking a developer for one-time help).

---

## What you need before starting

| Item | Why you need it |
|------|-----------------|
| A computer (Mac, Windows, or Linux) | To run the app locally |
| Internet connection | TikTok and video download need internet |
| A **TikTok account** | The account you want to post to |
| A **TikTok Developer account** | Free — to get API keys for your app |
| **Node.js** (version 18 or newer) | Runs the app — [download here](https://nodejs.org/) |
| **ngrok** (free) | Explained below — required for TikTok login on your computer |

---

## What is ngrok? (Simple explanation)

When you run this app, it lives at `http://localhost:3000` — only **your computer** can open that address. TikTok's servers cannot reach `localhost`, and TikTok **requires a secure HTTPS link** for login.

**ngrok** creates a temporary public link (like `https://abc123.ngrok-free.app`) that forwards traffic to your computer. It is like giving your local app a short-term address on the internet so TikTok can send you back after you log in.

```
TikTok  →  https://your-name.ngrok-free.app  →  your computer (localhost:3000)
```

### Install ngrok

1. Go to [https://ngrok.com/](https://ngrok.com/) and create a free account.
2. Download ngrok for your operating system.
3. Follow ngrok's setup guide to connect your account (one-time `ngrok config add-authtoken ...` step).

### Run ngrok (every time you use the app)

Open a **second terminal window** and run:

```bash
ngrok http 3000
```

You will see a line like:

```
Forwarding   https://98e7-100-20-204-40.ngrok-free.app -> http://localhost:3000
```

Copy that `https://....ngrok-free.app` URL — you will need it in the steps below.

> **Note:** On the free plan, this URL **changes every time** you restart ngrok. When it changes, you must update your `.env` file and TikTok Developer Portal (see below).

---

## One-time setup

### Step 1 — Create a TikTok Developer app

1. Go to [https://developers.tiktok.com/](https://developers.tiktok.com/) and sign in.
2. Click **Manage apps** → **Connect an app** (or use an existing app).
3. Fill in app details (name, description, icon).
4. Under **Products**, add:
   - **Login Kit** (turn on **Configure for Web**)
   - **Content Posting API**
5. Note your **Client Key** and **Client Secret** (click the eye icon to reveal the secret).

### Step 2 — Add your Redirect URI in TikTok Portal

TikTok needs to know where to send users after they log in.

1. In your app → **Login Kit** → **Configure for Web**.
2. Add this Redirect URI (replace with **your current ngrok URL**):

```
https://YOUR-NGROK-URL.ngrok-free.app/auth/callback
```

Example:

```
https://98e7-100-20-204-40.ngrok-free.app/auth/callback
```

3. Click **Save**.

> TikTok does **not** accept `http://localhost:3000` as a redirect URI. You must use the **ngrok HTTPS URL**.

### Step 3 — Install project dependencies

Open a terminal in this project folder and run:

```bash
yarn install
```

(Or `npm install` if you prefer npm.)

### Step 4 — Configure your `.env` file

1. Copy the example file:

```bash
cp .env.example .env
```

2. Open `.env` in any text editor and fill in:

```env
TIKTOK_CLIENT_KEY=your_client_key_from_tiktok_portal
TIKTOK_CLIENT_SECRET=your_client_secret_from_tiktok_portal
REDIRECT_URI=https://YOUR-NGROK-URL.ngrok-free.app/auth/callback
PORT=3000
SESSION_SECRET=any_long_random_string_here
```

**Important:** `REDIRECT_URI` must match **exactly** what you saved in the TikTok Developer Portal (same ngrok URL, same `/auth/callback` path).

For `SESSION_SECRET`, you can use any long random text, or run:

```bash
openssl rand -hex 32
```

---

## How to run the app (every time)

You need **two terminal windows** open at the same time.

### Terminal 1 — Start the app

```bash
yarn dev
```

You should see:

```
🚀  TikTok Video Publisher running at http://localhost:3000
    Public URL:   https://your-ngrok-url.ngrok-free.app
    Redirect URI: https://your-ngrok-url.ngrok-free.app/auth/callback
```

### Terminal 2 — Start ngrok

```bash
ngrok http 3000
```

### Open the app in your browser

Use your **ngrok URL** (not localhost):

```
https://YOUR-NGROK-URL.ngrok-free.app
```

The first time, ngrok may show a warning page — click **Visit Site** to continue.

---

## How to use the app

### 1. Connect TikTok

- Click **Connect with TikTok**.
- Log in and approve permissions (`video.upload` and `video.publish`).
- You will return to the app and see **Connected as @your_username**.

### 2. Prepare your TikTok account (important for testing)

If your TikTok app is **not yet audited** by TikTok (most new apps are in this state):

1. Open the **TikTok mobile app**.
2. Go to **Profile → Menu → Settings and privacy → Privacy**.
3. Turn on **Private account**.
4. In this web app, choose privacy **Only me** before publishing.

Unaudited apps can only post private videos, and your TikTok profile must be set to private at the time of posting.

### 3. Paste a video URL

The link must be:

- **HTTPS** (starts with `https://`)
- **Publicly accessible** (anyone with the link can download it)
- A **direct video file** (MP4, WebM, or MOV) — not a dashboard or preview page
- **Under 4 GB**

Good example:

```
https://example.com/videos/my-video.mp4
```

Bad examples:

- `http://...` (not secure)
- YouTube or TikTok watch page links (not direct files)
- Links that require login

### 4. Publish

1. Add a caption (optional).
2. Select privacy (for testing, use **Only me**).
3. Click **🚀 Publish to TikTok**.
4. Wait for processing — you will see a status update when done.

---

## Common problems and fixes

| Problem | What to do |
|---------|------------|
| **"This site can't be reached"** on ngrok URL | ngrok is not running. Run `ngrok http 3000` in Terminal 2. |
| **ngrok warning page** | Normal on free plan. Click **Visit Site**. |
| **Invalid state parameter** | Open the app using the **ngrok URL**, not `localhost`. Clear browser cookies and try again. |
| **code_challenge error** on TikTok login | Make sure you are using the latest version of this project (PKCE is required). Restart the app and try again. |
| **Token exchange failed** | Check that `REDIRECT_URI` in `.env` matches TikTok Portal exactly. |
| **Unaudited app / private account error** | Set TikTok account to **Private** in the TikTok app. Choose **Only me** in this tool. |
| **URL ownership / chunk errors** | Use a direct HTTPS MP4 link. The app downloads and uploads the file for you. |
| **ngrok URL changed** after restart | Update `.env` `REDIRECT_URI` and TikTok Portal Redirect URI with the new ngrok URL. Restart `yarn dev`. |

---

## When ngrok URL changes (checklist)

Every time you restart ngrok on the free plan:

1. Copy the new `https://....ngrok-free.app` URL from the ngrok terminal.
2. Update `.env`:

   ```env
   REDIRECT_URI=https://NEW-URL.ngrok-free.app/auth/callback
   ```

3. Update the same URL in **TikTok Developer Portal** → Login Kit → Redirect URI.
4. Restart the app (`Ctrl+C` then `yarn dev` again).
5. Open the new ngrok URL in your browser.

---

## Project structure (for developers)

```
TikTok Video Upload/
├── server.js          # Backend: TikTok OAuth, video download, upload
├── public/
│   └── index.html     # Web page you see in the browser
├── .env               # Your secret keys (never share or commit this)
├── .env.example       # Template for .env
├── package.json       # Project dependencies
└── README.md          # This file
```

---

## TikTok limitations to know

- **Unaudited apps** can only post with **Only me** privacy, and the user's TikTok account must be **private**.
- **Maximum 5 users** can post per 24 hours on unaudited apps.
- To post **public** videos, your TikTok Developer app must pass TikTok's **app audit**.
- Access tokens expire after about **24 hours** — you may need to reconnect TikTok.

---

## Useful links

- [TikTok for Developers](https://developers.tiktok.com/)
- [Login Kit (Web) documentation](https://developers.tiktok.com/doc/login-kit-web/)
- [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started)
- [ngrok documentation](https://ngrok.com/docs)

---

## Quick start summary

```bash
# 1. Install dependencies (once)
yarn install
cp .env.example .env
# Edit .env with your TikTok keys and ngrok redirect URI

# 2. Every session — Terminal 1
yarn dev

# 3. Every session — Terminal 2
ngrok http 3000

# 4. Browser
# Open https://YOUR-NGROK-URL.ngrok-free.app
```

---

## Need help?

If something does not work:

1. Check both terminals are running (`yarn dev` and `ngrok http 3000`).
2. Confirm `.env` and TikTok Portal use the **same** ngrok redirect URI.
3. Try in a private/incognito browser window after clearing cookies.
4. Share the error message from the red box on the page or from the terminal — that helps pinpoint the issue quickly.
