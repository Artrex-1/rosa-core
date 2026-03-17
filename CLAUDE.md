# Rosa-Core — Centrale API Server

## BELANGRIJK
Dit is een Express API server op port 3100. Dit is GEEN npm package.
Behandel dit NOOIT als een library die je importeert via require().

## Structuur
- `src/server.js` — Hoofdbestand (Express app)
- `src/routes/` — API routes (memory, tasks, projects, health)
- `src/db/` — SQLite database (schema, database module)
- `src/middleware/` — Auth middleware (API key)
- `data/` — SQLite database bestanden (NIET verwijderen)

## Starten
```
npm start        # of: node src/server.js
npm run dev      # met --watch
```
Draait via PM2 in productie.

## API Endpoints
- /health — Health check (geen auth)
- /memory — Conversatie opslag en zoeken
- /tasks — Taak aanmaken, ophalen, voltooien
- /projects — Projecten en kennisbank

## Dependencies
express, cors, better-sqlite3, dotenv, uuid

## Relatie met andere Rosa's
- rosa-telegram connecteert hiermee via HTTP (RosaCoreClient)
- rosa-laptop pollt /tasks/pending en voert taken uit
- Communicatie is ALTIJD via HTTP API, nooit via directe imports
