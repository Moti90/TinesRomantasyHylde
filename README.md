# Tines Romantasy Liste

Lokal webapp der researcher romantasy-serier på nettet, scorer dem efter Tines håndbog, viser listen i browseren, og kan importere/eksportere Excel.

## Start (til Tine)

1. Dobbeltklik **`Start Tines Database.bat`**
2. Browser åbner på `http://localhost:3847`
3. Tilføj serie med navn → **Analysér og tilføj**

Valgfrit: forfatter (hvis flere bøger har samme titel) og link.

## Sådan virker analysen

1. **Identifikation** – Open Library + Google Books (titel + forfatter)
2. **Webresearch** – OpenAI Responses API med `web_search` (kilder, Goodreads hvis verificeret)
3. **Håndbogsanalyse** – separat, billigere modelkald uden web search

- **Genanalysér** genbruger gemt research (ingen ny web search)
- **Opdatér oplysninger** laver ny webresearch + analyse

Research caches lokalt i ca. 60 dage (`data/research-cache/`).

## OpenAI

1. Kopiér `.env.example` til `.env`
2. Sæt `OPENAI_API_KEY=din_nøgle`
3. Genstart appen

Alternativt: gem nøglen i `data/config.json` som `openaiApiKey` (filen er gitignored).

Nøglen bruges kun på serveren og sendes aldrig til browseren.

## Excel

- **Importér Excel** – indlæs eksisterende liste
- **Eksportér Excel** – downloader `Tines_Romantasy_Database.xlsx`
- Afkryds “Flet ved import” for at beholde eksisterende + tilføje nye

## Udvikling

```bash
npm install
npm start
npm test
```

### Deploy (Railway)

Se **[RAILWAY.md](./RAILWAY.md)** — ca. $5/md, offentlig URL til Tine, volume til at gemme listen.

### Miljøvariabler

| Variabel | Betydning | Default |
|----------|-----------|---------|
| `OPENAI_API_KEY` | API-nøgle | — |
| `PORT` | Serverport | `3847` |
| `DATA_DIR` | Persistensmappe (Railway volume) | `./data` |
| `PIRATEREADS_USER_ID` | PirateReads/Goodreads user id | `155251530` |
| `OPENAI_RESEARCH_MODEL` | Model til webresearch | `gpt-4o` |
| `OPENAI_ANALYSIS_MODEL` | Model til håndbogsanalyse | `gpt-4o-mini` |
| `RESEARCH_CACHE_DAYS` | Cache-levetid for research | `7` |
| `GOODREADS_CACHE_DAYS` | Cache-levetid for Goodreads-del | `30` |

### Admin

`GET /api/admin/status` — teknisk status (ikke til Tines primære UI).

## Krav

- [Node.js 18+](https://nodejs.org)
