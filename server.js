require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ───────────────────────────────────────────────────────────────────
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const PUBLIC_BASE_URL = REDIRECT_URI.replace(/\/auth\/callback\/?$/, "");
const IS_HTTPS_REDIRECT = REDIRECT_URI.startsWith("https://");

const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const isLocalhost = req.hostname === "localhost" || req.hostname === "127.0.0.1";
  const redirectHost = new URL(REDIRECT_URI).hostname;
  if (isLocalhost && redirectHost !== "localhost" && redirectHost !== "127.0.0.1") {
    return res.redirect(`${PUBLIC_BASE_URL}${req.originalUrl}`);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: IS_HTTPS_REDIRECT,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60,
    },
  })
);

// ─── Auth Routes ──────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(codeVerifier) {
  // TikTok expects hex-encoded SHA256, not standard base64url PKCE.
  return crypto.createHash("sha256").update(codeVerifier).digest("hex");
}

app.get("/auth/login", (req, res) => {
  if (!TIKTOK_CLIENT_KEY) {
    return res.status(500).json({ error: "TIKTOK_CLIENT_KEY not set in .env" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  req.session.oauthState = state;
  req.session.codeVerifier = codeVerifier;

  const params = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    scope: "video.upload,video.publish",
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Failed to start OAuth flow" });
    }
    res.redirect(`${TIKTOK_AUTH_URL}?${params.toString()}`);
  });
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error_description || error)}`);
  }

  if (state !== req.session.oauthState) {
    return res.redirect("/?error=Invalid+state+parameter");
  }

  if (!req.session.codeVerifier) {
    return res.redirect("/?error=Missing+PKCE+verifier.+Please+try+logging+in+again.");
  }

  try {
    const tokenRes = await axios.post(
      TIKTOK_TOKEN_URL,
      new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: req.session.codeVerifier,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const tokenData = tokenRes.data;
    if (tokenData.error) {
      const msg = tokenData.error_description || tokenData.error;
      return res.redirect(`/?error=${encodeURIComponent(msg)}`);
    }

    const { access_token, open_id, expires_in, refresh_token } = tokenData;
    if (!access_token) {
      console.error("Unexpected token response:", tokenData);
      return res.redirect("/?error=No+access+token+in+TikTok+response");
    }

    req.session.tiktok = { access_token, open_id, expires_in, refresh_token };
    req.session.oauthState = null;
    req.session.codeVerifier = null;
    res.redirect("/?loggedIn=true");
  } catch (err) {
    const body = err.response?.data;
    console.error("Token exchange error:", body || err.message);
    const msg =
      body?.error_description ||
      body?.error?.message ||
      body?.error ||
      "Token exchange failed";
    res.redirect(`/?error=${encodeURIComponent(msg)}`);
  }
});

app.get("/auth/status", (req, res) => {
  if (req.session.tiktok?.access_token) {
    res.json({ loggedIn: true, open_id: req.session.tiktok.open_id });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ─── Video Publish Helpers ────────────────────────────────────────────────────

const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024;
const MULTI_CHUNK_BYTES = 10 * 1024 * 1024;

function getChunkPlan(videoSize) {
  // TikTok: videos under 5 MB must be uploaded whole.
  // Videos up to 64 MB can also be uploaded as a single chunk.
  if (videoSize < MIN_CHUNK_BYTES || videoSize <= MAX_SINGLE_CHUNK_BYTES) {
    return { chunk_size: videoSize, total_chunk_count: 1 };
  }

  // Videos larger than 64 MB must be split.
  const chunk_size = MULTI_CHUNK_BYTES;
  const total_chunk_count = Math.floor(videoSize / chunk_size);
  return { chunk_size, total_chunk_count };
}

function guessMimeType(videoUrl, contentType) {
  if (contentType && contentType.startsWith("video/")) {
    return contentType.split(";")[0].trim();
  }
  const ext = path.extname(new URL(videoUrl).pathname).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

async function downloadVideo(videoUrl) {
  if (!videoUrl.startsWith("https://")) {
    throw new Error("Video URL must use HTTPS");
  }

  const videoRes = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    maxRedirects: 5,
    maxContentLength: MAX_VIDEO_BYTES,
    timeout: 5 * 60 * 1000,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const videoSize = videoRes.data.byteLength;
  if (!videoSize) throw new Error("Video URL returned an empty file");
  if (videoSize > MAX_VIDEO_BYTES) throw new Error("Video is larger than TikTok's 4 GB limit");

  return {
    buffer: Buffer.from(videoRes.data),
    videoSize,
    mimeType: guessMimeType(videoUrl, videoRes.headers["content-type"]),
  };
}

async function uploadVideoChunks(uploadUrl, buffer, videoSize, mimeType) {
  const { chunk_size, total_chunk_count } = getChunkPlan(videoSize);

  for (let index = 0; index < total_chunk_count; index++) {
    const start = index * chunk_size;
    const end = Math.min(start + chunk_size, videoSize) - 1;
    const chunk = buffer.subarray(start, end + 1);

    const uploadRes = await axios.put(uploadUrl, chunk, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": chunk.length,
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: (status) => [200, 201, 206].includes(status),
    });

    const expectedStatus = index === total_chunk_count - 1 ? 201 : 206;
    if (uploadRes.status !== expectedStatus) {
      throw new Error(`Unexpected upload response: ${uploadRes.status}`);
    }
  }
}

function formatTikTokError(err) {
  const tiktokError = err.response?.data?.error;
  if (!tiktokError) return err.message || "Request failed";

  if (tiktokError.code === "url_ownership_unverified") {
    return "That video URL is not on a domain verified in your TikTok app.";
  }
  if (tiktokError.code === "unaudited_client_can_only_post_to_private_accounts") {
    return "Your TikTok account must be set to Private in the TikTok app before posting. Then choose privacy 'Only me'.";
  }

  return tiktokError.message || tiktokError.code || "Request failed";
}

app.get("/creator/info", async (req, res) => {
  if (!req.session.tiktok?.access_token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { access_token } = req.session.tiktok;
    const infoRes = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/creator_info/query/`,
      {},
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    if (infoRes.data.error?.code && infoRes.data.error.code !== "ok") {
      throw new Error(infoRes.data.error.message || infoRes.data.error.code);
    }

    res.json({ ok: true, ...infoRes.data.data });
  } catch (err) {
    console.error("Creator info error:", err.response?.data || err.message);
    res.status(500).json({ error: formatTikTokError(err) });
  }
});

// ─── Video Publish Routes ─────────────────────────────────────────────────────

app.post("/publish", async (req, res) => {
  if (!req.session.tiktok?.access_token) {
    return res.status(401).json({ error: "Not authenticated. Please log in with TikTok first." });
  }

  const {
    video_url,
    title = "",
    privacy_level = "SELF_ONLY",
    disable_comment = false,
    disable_duet = false,
    disable_stitch = false,
  } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: "video_url is required" });
  }

  try {
    const { access_token } = req.session.tiktok;
    const authHeaders = {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json; charset=UTF-8",
    };
    const postInfo = {
      title: title.slice(0, 2200),
      privacy_level,
      disable_comment: Boolean(disable_comment),
      disable_duet: Boolean(disable_duet),
      disable_stitch: Boolean(disable_stitch),
      video_cover_timestamp_ms: 1000,
    };

    const { buffer, videoSize, mimeType } = await downloadVideo(video_url);
    const { chunk_size, total_chunk_count } = getChunkPlan(videoSize);

    console.log(`Uploading video: ${videoSize} bytes, chunk_size=${chunk_size}, chunks=${total_chunk_count}`);

    const initRes = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/video/init/`,
      {
        post_info: postInfo,
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size,
          total_chunk_count,
        },
      },
      { headers: authHeaders }
    );

    if (initRes.data.error?.code && initRes.data.error.code !== "ok") {
      throw Object.assign(new Error(initRes.data.error.message || initRes.data.error.code), {
        response: { data: initRes.data },
      });
    }

    const { publish_id, upload_url } = initRes.data.data || {};
    if (!publish_id || !upload_url) {
      throw new Error("TikTok did not return publish_id or upload_url");
    }

    await uploadVideoChunks(upload_url, buffer, videoSize, mimeType);
    res.json({ ok: true, publish_id });
  } catch (err) {
    console.error("Publish error:", err.response?.data || err.message);
    res.status(500).json({ error: formatTikTokError(err) });
  }
});

app.get("/publish/status/:publishId", async (req, res) => {
  if (!req.session.tiktok?.access_token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { access_token } = req.session.tiktok;
    const statusRes = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
      { publish_id: req.params.publishId },
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    const data = statusRes.data.data;
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error("Status error:", err.response?.data || err.message);
    res.status(500).json({ error: formatTikTokError(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀  TikTok Video Publisher running at http://localhost:${PORT}`);
  console.log(`    Public URL:   ${PUBLIC_BASE_URL}`);
  console.log(`    Redirect URI: ${REDIRECT_URI}\n`);
});
