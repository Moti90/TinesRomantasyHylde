# Deploy på Railway

Så Tine kan åbne appen som en rigtig hjemmeside.

## 1. Forudsætninger
- GitHub-repo: https://github.com/Moti90/TinesRomantasyHylde
- Railway-konto (tilmeld med GitHub)
- OpenAI API-nøgle

## 2. Opret projekt
1. Gå til [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Vælg `Moti90/TinesRomantasyHylde`
3. Railway bygger automatisk (`npm install` + `npm start`)

## 3. Environment variables
I service → **Variables**:

| Navn | Værdi |
|------|--------|
| `OPENAI_API_KEY` | din OpenAI-nøgle |
| `DATA_DIR` | `/data` |
| `PIRATEREADS_USER_ID` | `155251530` (valgfri, default er sat) |
| `NODE_ENV` | `production` |

`PORT` sættes automatisk af Railway.

## 4. Volume (vigtigt!)
Uden volume mistes Tines liste ved hver gendeploy.

1. Service → **Volumes** → **Add Volume**
2. Mount path: `/data`
3. Genstart servicen

Appen seed’er automatisk handbook, series, taste-profile m.m. ind i volume første gang.

## 5. Offentlig URL
1. Service → **Settings** → **Networking** → **Generate Domain**
2. Du får noget i stil med `https://tinesromantasyhylde-production.up.railway.app`
3. Send linket til Tine / bookmark det

## 6. Opdateringer
Push til `master` på GitHub → Railway gendeployer.
Volume (`/data`) bevarer listen mellem deploys.

## 7. Tjek
Åbn `/api/health` — skal vise `ready: true` når OpenAI-nøglen er sat.

## Pris
Hobby ~$5/md for denne type app + OpenAI-forbrug separat.
