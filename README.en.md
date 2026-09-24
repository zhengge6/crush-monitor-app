# jev-crush

<p align="center">
  <img src="docs/assets/logo.png" alt="好感度分析" width="96" />
</p>

<p align="center">
  <b>A two-person chat, read as signals of how they feel about you.</b><br/>
  Paste the transcript, mark which side is you. Emotion, intent, reply grade, and affinity sit on the bubbles.
</p>

<p align="center">
  <a href="README.md">中文</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/FerryCorleone/crush-monitor">Based on Crush Monitor</a>
  &nbsp;·&nbsp;
  <a href="https://typesafe.ai/blog/introducing-system-one-models-and-jev">Jev</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT</a>
</p>

<p align="center">
  <img src="docs/assets/shot-home.png" alt="Pick a relation" width="220" />
  &nbsp;
  <img src="docs/assets/shot-import.png" alt="Confirm which side is you" width="220" />
  &nbsp;
  <img src="docs/assets/shot-demo.png" alt="Tags on the original messages" width="220" />
</p>

<p align="center">
  <sub>Relation &nbsp;·&nbsp; which side is you &nbsp;·&nbsp; tags on the original lines</sub>
</p>

It does not write an essay about the relationship. Each message from them gets emotion and intent, each of yours gets a reply grade, and the thread becomes one affinity number. That number is a model judgment, not proof of how they feel.

## Paste and read

A WeChat desktop copy works. So does one line per turn:

```text
Me: free tonight?
Alex: yes, what do you want to eat
```

QQ and WhatsApp text exports work too. A clock time is not treated as a third person. If the paste is not two people, Start stays disabled and the screen says why.

After you pick your side:

- Their bubbles show emotion and intent
- Yours show a reply grade
- The header shows affinity for this stretch, and a next step

Relation context changes the rubric: crush, friend or colleague, social chat. A teacher checking in is not scored as romance.

## Run

Node.js 22.12 or newer.

```bash
git clone https://github.com/zhengge6/jev-crush.git
cd jev-crush
npm ci
cp .env.example .env
```

Put a `JEV_API_KEY` in `.env` (TypeSafe, Vercel AI Gateway, or OpenRouter). Then:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:3178/`. `npm run dev` serves the UI on port `5178` and proxies the API to `3178`.

The key stays on the server. Chat text is sent to the provider you picked, and usage is billed to that key.

## Admin

| Task | Where |
| --- | --- |
| Analyze a chat | `/` |
| Review synced chats, fill tags, export | `/admin` |
| Redeem codes | Admin. Analysis is not gated while `REDEEM_ENABLED=false` |

The admin view uses the same bubbles. A chat that already has tags is not sent through the model again. One without tags can be analyzed once and stored. Export is either `Me: text` lines or one tall screenshot.

Swapping which side is you reuses a finished local result for that same transcript and relation.

## Limits

- Two people, text only. Images and voice stay as placeholders.
- The model does not see tone of voice or anything that happened offline.
- Synced transcripts are visible to the admin. Do not import highly sensitive chats.
- Trial and redeem limits apply only after you set `REDEEM_ENABLED`.

## Config

| Variable | Role |
| --- | --- |
| `JEV_PROVIDER` | `typesafe`, `vercel`, or `openrouter` |
| `JEV_API_KEY` | Server-only key |
| `PORT` / `HOST` | Default `3178` / `0.0.0.0` |
| `AUTH_ENABLED` | Accounts |
| `REDEEM_ENABLED` | Redeem-code gate |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login. Rotate the password after deploy |
| `CRUSH_DATA_DIR` | Where chats and codes are stored |

Do not commit `.env`, redeem stores, or user chats. Deploy notes are in `deploy/`. Keep the repo root `index.html` pointed at `/src/main.tsx`.

## Stack

React 19, TypeScript, Vite, Express 5, Zod. Judgments come from Jev. Storage is local JSON.

```text
src/          chat UI, login, analysis state
server/       analyze, auth, redeem, sync, admin
shared/       parse, scoring, sync snapshot
docs/assets/  logo and screenshots
deploy/       systemd unit and install script
```

## Credit

Derivative of [Crush Monitor](https://github.com/FerryCorleone/crush-monitor) by [@FerryCorleone](https://github.com/FerryCorleone) (MIT). The model is [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) by TypeSafe. If this repo is where you found the idea, star the original too. See [NOTICE](NOTICE).

[MIT](LICENSE)
