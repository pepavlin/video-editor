# Technical Debt & Architectural Analysis

> **Datum analýzy:** 2026-02-28
> **Verze projektu:** 1.0.0
> **Stav:** MVP – lokální video editor

Tento dokument shrnuje nalezené slabiny v architektuře, mezery v kódu a chyby nalezené důkladnou analýzou celého projektu. Každý bod je ohodnocen závažností a obsahuje konkrétní doporučení k nápravě.

---

## Obsah

1. [Kritické chyby](#1-kritické-chyby)
2. [Závažné problémy](#2-závažné-problémy)
3. [Architektonické slabiny](#3-architektonické-slabiny)
4. [Škálovatelnost](#4-škálovatelnost)
5. [Kvalita kódu](#5-kvalita-kódu)
6. [Mezery v testech](#6-mezery-v-testech)
7. [Bezpečnost](#7-bezpečnost)
8. [Dokumentace](#8-dokumentace)

---

## 1. Kritické chyby

### CRIT-01: Autosave race condition – potenciální ztráta dat

**Soubor:** `apps/web/src/hooks/useProject.ts:62–75`
**Závažnost:** KRITICKÁ

**Popis:**
Autosave mechanismus čistí předchozí `setTimeout` ale NEČISTÍ in-flight HTTP požadavek. Pokud jsou dvě uložení spuštěna téměř současně (např. uživatel provede akci v průběhu pomalého síťového uložení), může starší odpověď přijít po novější a přepsat novější stav projektu.

```typescript
// Problém: save A běží, pak se spustí save B
// Pokud A přijde ze sítě PO B → server má starší stav jako "aktuální"
autosaveRef.current = setTimeout(async () => {
  await api.saveProject(project); // žádná ochrana před race condition
}, AUTOSAVE_DELAY);
```

**Doporučení:**
- Přidat sekvenční čítač (generation counter) ke každé save operaci
- Na serveru odmítat uložení se starším čítačem než je aktuální
- Nebo použít request queue (serializovat save operace)
- Alternativně: CRDT (Conflict-free Replicated Data Type) pro merge změn

---

### CRIT-02: Žádné zamykání souborů – corrupted JSON při concurrent requests

**Soubor:** `apps/api/src/services/workspace.ts`
**Závažnost:** KRITICKÁ

**Popis:**
Funkce `saveProject` a `loadProject` čtou a zapisují JSON soubory bez jakéhokoliv souborového zamykání (`flock`, mutex). Pokud dva požadavky zapíší do `project.json` současně (např. autosave z dvou záložek prohlížeče), výsledný soubor bude corrupted nebo bude obsahovat starší verzi.

```typescript
// workspace.ts – žádné zamykání, žádná kontrola souběžnosti
export function saveProject(project: Project): void {
  const p = path.join(getProjectDir(project.id), 'project.json');
  fs.writeFileSync(p, JSON.stringify(project, null, 2)); // může přepsat jiný zápis
}
```

**Doporučení:**
- Implementovat write-queue per project ID (mutex přes Map)
- Nebo použít `fs.rename` + atomic writes (zapsat do temp souboru, pak rename)
- Zvážit SQLite pro atomické transakce

---

### CRIT-03: deleteClip nečistí orphaned effect tracks

**Soubor:** `apps/web/src/hooks/useProject.ts:470–484`
**Závažnost:** KRITICKÁ

**Popis:**
Když se smaže video clip, effect tracky které na něj odkazují skrz `parentTrackId` zůstanou v projektu jako "osiřelé". Tyto tracky pak cílí na neexistující clip a způsobují chyby při exportu i ve preview.

```typescript
const deleteClip = useCallback(
  (clipId: string) => {
    updateProject((p) => ({
      ...p,
      tracks: removeEmptyTracks(
        p.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
          // ❌ effect tracky s parentTrackId odkazující na smazaný track zůstávají
        }))
      ),
    }));
  },
  [updateProject]
);
```

**Doporučení:**
- Po smazání clipu najít a smazat všechny effect tracky jejichž `parentTrackId` odpovídá tracku, ze kterého byl clip smazán (a track se stal prázdným)
- Nebo přidat garbage collection effect tracků bez platného rodiče

---

### CRIT-04: Chybí funkce deleteTrack

**Soubor:** `apps/web/src/hooks/useProject.ts`
**Závažnost:** KRITICKÁ

**Popis:**
Hook `useProject` neexportuje funkci `deleteTrack`. Tracky lze smazat pouze nepřímo přes `removeEmptyTracks` (smazáním posledního clipu). To znamená, že uživatel nemůže explicitně smazat prázdný master track ani effect track bez odebrání všech jeho clipů. Tato funkce je zásadní pro základní UX video editoru.

**Doporučení:**
- Implementovat `deleteTrack(trackId: string)`
- Smazání track musí taky smazat všechny orphaned effect tracky odkazující na smazaný track

---

## 2. Závažné problémy

### HIGH-01: In-memory job queue – ztráta stavu při restartu

**Soubor:** `apps/api/src/services/jobQueue.ts`
**Závažnost:** VYSOKÁ

**Popis:**
Job queue je čistě in-memory. Restart API serveru způsobí ztrátu všech informací o běžících jobech. `workspace.ts` sice označí stale joby jako `ERROR` při startu, ale:
- Uživatel neví, jestli job doběhl nebo selhal
- Není žádný mechanismus pro retry
- Dlouhé exporty (desítky minut) jsou ztraceny při restartu Docker kontejneru

**Doporučení:**
- Persistovat stav jobů do `job.json` průběžně (každých N sekund nebo na každý progress update)
- Implementovat job recovery při startu (obnovit RUNNING joby jako schopné retry)
- Zvážit BullMQ nebo pg-boss pro robustní frontu

---

### HIGH-02: Chybí limit souběžných jobů

**Soubor:** `apps/api/src/services/jobQueue.ts`
**Závažnost:** VYSOKÁ

**Popis:**
JobQueue spouští child procesy bez jakéhokoliv limitu souběžnosti. N simultánních export požadavků = N souběžných FFmpeg procesů, které mohou vyčerpat RAM/CPU serveru.

```typescript
// Žádný semaphore, žádný pool, žádný limit
async function spawnProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ... }); // spustí hned bez čekání
  });
}
```

**Doporučení:**
- Implementovat concurrency limit (např. max 2 export joby současně)
- Přidat queueing s prioritizací
- Expozovat `GET /api/jobs/queue-status` endpoint

---

### HIGH-03: Chybí vstupní validace na API route handlers

**Soubor:** `apps/api/src/routes/assets.ts`, `routes/projects.ts`
**Závažnost:** VYSOKÁ

**Popis:**
Routes nemají Fastify JSON Schema validaci (`schema: { body: ... }`). Vstupní data jsou buď ručně validována nebo vůbec. To vede k nekontrolovaným runtime chybám místo jasných HTTP 400 odpovědí.

**Doporučení:**
- Definovat Fastify JSON Schema pro každý route handler
- Nebo integrovat Zod s `fastify-type-provider-zod`
- Při validační chybě vždy vracet 400 s popisem problému

---

### HIGH-04: Žádný rate limiting

**Soubor:** `apps/api/src/index.ts`
**Závažnost:** VYSOKÁ

**Popis:**
API nemá žádný rate limiting. Útočník nebo chybný klient může:
- Spamovat `/api/assets/import` a zahltit disk
- Spamovat `/api/projects/:id/export` a spustit desítky FFmpeg procesů
- Způsobit DoS na sdíleném hostiteli

**Doporučení:**
- Přidat `@fastify/rate-limit` middleware
- Různé limity pro různé typy endpointů (import: 10/min, export: 2/min)

---

### HIGH-05: Effect tracky nemají validaci existence rodiče

**Soubor:** `apps/web/src/hooks/useProject.ts:121–186`
**Závažnost:** VYSOKÁ

**Popis:**
Effect tracky odkazují na svůj parent video track přes `parentTrackId`. Pokud je parent video track smazán nebo přejmenován, effect track zůstane s neplatným odkazem. ExportPipeline se o to nepokouší ověřit, což způsobuje tiché chyby při exportu.

**Doporučení:**
- Přidat validaci integrity projektu (`validateProjectIntegrity(project)`)
- Při načtení projektu zkontrolovat, zda všechny `parentTrackId` odkazují na existující tracky
- Zobrazit varování uživateli při detekci integrity problémů

---

### HIGH-06: Žádná autentizace ani autorizace

**Soubor:** Celé API
**Závažnost:** VYSOKÁ (pro multi-user nebo síťové prostředí)

**Popis:**
API server nemá žádnou autentizaci. Jakýkoliv klient s přístupem k portu 3001 může číst, měnit nebo mazat jakékoliv projekty a assety. Pro lokální single-user použití je to OK, ale dokumentace by to měla explicitně varovat.

**Doporučení:**
- Dokumentovat, že API je pouze pro lokální/trusted-network použití
- Pro produkční nasazení přidat API token autentizaci nebo OAuth
- Minimálně přidat `X-Api-Key` header validaci

---

## 3. Architektonické slabiny

### ARCH-01: Timeline.tsx a Preview.tsx jsou God Components

**Soubory:** `apps/web/src/components/Timeline.tsx` (2 081 řádků), `Preview.tsx` (2 199 řádků)
**Závažnost:** STŘEDNÍ

**Popis:**
Obě komponenty jsou extrémně velké a obsahují příliš mnoho zodpovědností:
- `Timeline.tsx`: clip drag, trim, snap na beaty, snap na clipy, keyboard shortcuts, rendering, context menu, zoom
- `Preview.tsx`: canvas rendering, video element lifecycle, WebAudio sync, zoom management, frame seeking

Tyto soubory jsou těžko pochopitelné, testovatelné a rozšiřitelné.

**Doporučení:**
- Extrahovat `useTimelineDrag`, `useTimelineSnap`, `useTimelineTrim` hooks
- Extrahovat `useVideoElements`, `useCanvasRenderer` z Preview.tsx
- Cílit na max ~400 řádků na komponentu

---

### ARCH-02: Polling pro job progress místo SSE/WebSocket

**Soubor:** `apps/web/src/components/Editor.tsx:193`
**Závažnost:** STŘEDNÍ

**Popis:**
Job progress je implementován klientskou polling smyčkou (`setInterval`). To znamená:
- Zbytečné HTTP requesty každou sekundu i v klidném stavu
- Latence progress updates (až 1 sekunda)
- Nepříjemné škálování (každý tab = N polling connections)

**Doporučení:**
- Implementovat Server-Sent Events (SSE) pro job progress
- API endpoint: `GET /api/jobs/:id/stream` vracející `text/event-stream`
- Fallback na polling pro prostředí bez SSE support

---

### ARCH-03: Inspector.tsx musí být modifikován pro každý nový typ efektu

**Soubor:** `apps/web/src/components/Inspector.tsx` (1 359 řádků)
**Závažnost:** STŘEDNÍ

**Popis:**
Inspector obsahuje explicitní `switch/if` pro každý typ efektu při renderování effect panelů. Přidání nového efektu vyžaduje modifikaci Inspector.tsx, což porušuje Open/Closed Principle.

```typescript
// Inspector.tsx – každý nový efekt = nový case
switch (effectType) {
  case 'beatZoom': return <BeatZoomEffectPanel ... />;
  case 'cutout':   return <CutoutEffectPanel ... />;
  // ...
}
```

**Doporučení:**
- Přidat `InspectorPanel?: React.ComponentType<...>` do `EffectDefinition` v `packages/elements`
- Inspector pak dynamicky renderuje panel z registru bez znalosti konkrétních efektů
- Stejný princip již funguje pro preview/export, Inspector by měl být konzistentní

---

### ARCH-04: Clip typ je "bag of optional fields" místo discriminated union

**Soubor:** `packages/shared/src/types.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
Typ `Clip` používá volitelné pole místo discriminated union, takže TypeScript neumí staticky zaručit konzistenci:

```typescript
// Současný stav – žádná statická garance
interface Clip {
  textContent?: string;    // jen pro text clip
  rectangleStyle?: RectangleStyle;  // jen pro rectangle clip
  lyricsContent?: string;  // jen pro lyrics clip
  effectConfig?: EffectClipConfig;  // jen pro effect clip
}

// Lepší přístup – discriminated union
type Clip = VideoClip | TextClip | RectangleClip | LyricsClip | EffectClip;
```

Runtime `canHandle()` funkce musí dělat duck-typing kontroly, které by měl TypeScript řešit staticky.

**Doporučení:**
- Refaktorovat `Clip` na discriminated union s `kind` nebo `clipType` diskriminátorem
- Aktualizovat všechny konzumenty (Editor, Timeline, Inspector, hooks)
- Tato změna je breaking – vhodné pro major verzi

---

### ARCH-05: Sdílené package nemají runtime validaci

**Soubor:** `packages/shared/src/types.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
`packages/shared` definuje TypeScript rozhraní bez runtime validace. Data načtená z disku (`project.json`, `assets.json`) jsou přetypována bez ověření struktury. Corrupted nebo migrated soubory způsobí tiché runtime chyby.

**Doporučení:**
- Přidat Zod schemas do `packages/shared` jako paralelní validátory k TypeScript typům
- Validovat projekt při načtení: `ZodProject.parse(raw)`
- Přidat migrační vrstvu pro backward compatibility

---

### ARCH-06: Žádné verzování API

**Soubor:** `apps/api/src/routes/`
**Závažnost:** STŘEDNÍ

**Popis:**
Všechny routes jsou na `/api/` bez verze. Breaking změny v API vyžadují koordinovaný deploy frontendu a backendu. Pro budoucí vývoj a potenciální třetí-strany integraci je verzování nezbytné.

**Doporučení:**
- Přidat prefix `/api/v1/` na všechny route handlery
- Implementovat přes Fastify `prefix` option

---

### ARCH-07: reactStrictMode je zakázán

**Soubor:** `apps/web/next.config.mjs`
**Závažnost:** STŘEDNÍ

**Popis:**
`reactStrictMode: false` je nastaveno kvůli WebAudio kompatibilitě. Strict Mode dvojité volání effect callbacks odhaluje chyby v lifecycle management. Zakázání Strict Mode skrývá potenciální memory leaky a problémy s AudioContext životním cyklem.

**Doporučení:**
- Opravit WebAudio lifecycle management tak, aby toleroval double-mount v Strict Mode
- Použít `useRef` místo `useState` pro AudioContext instanci
- Zapnout Strict Mode zpět

---

### ARCH-08: Demo projekt odkazuje na neexistující assety

**Soubor:** `demo/demo_project.json`
**Závažnost:** NÍZKÁ/STŘEDNÍ

**Popis:**
Demo projekt obsahuje hardcoded asset IDs které pravděpodobně neexistují ve freshly-nainstalovaném workspace. Načtení demo projektu způsobí prázdný editor nebo chyby.

**Doporučení:**
- Buď demo projekt odstranit, nebo přidat demo assets do repozitáře
- Implementovat "Load Demo" funkci která assets skutečně nahraje

---

## 4. Škálovatelnost

### SCALE-01: Filesystem persistence = single-instance deployment

**Závažnost:** VYSOKÁ pro produkci

**Popis:**
Celá persistentní vrstva je postavena na lokálním filesystému. Nelze horizontálně škálovat API (multiple instances by sdílely data přes NFS, ale bez koordinace zápisu). Neexistuje žádná podpora pro cloudové storage (S3, GCS).

**Doporučení:**
- Abstrahovat storage vrstvu do interface `IStorageBackend`
- Implementovat `LocalStorageBackend` (současný) a `S3StorageBackend`
- Pro databázi zvážit SQLite → PostgreSQL migrační cestu

---

### SCALE-02: Chybí stránkování v listing endpointech

**Soubory:** `apps/api/src/routes/assets.ts`, `routes/projects.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
`GET /api/assets` a `GET /api/projects` vrací vždy všechny záznamy. S tisíci assety bude odpověď obrovská a pomalá.

**Doporučení:**
- Přidat `?page=N&limit=50` parametry
- Nebo cursor-based pagination pro konsistenci při concurrent writes

---

### SCALE-03: Waveform data bez omezení velikosti

**Soubor:** `apps/api/src/services/waveform.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
Waveform JSON soubor je generován pro celý audio soubor bez downsamplingu závislého na délce. Pro 2-hodinový soubor bude waveform.json desítky MB.

**Doporučení:**
- Normalizovat počet datových bodů na délku (max N bodů na pixel nebo na sekundu)
- Implementovat lazy loading waveform dat po segmentech

---

### SCALE-04: Statické servírování celého workspace

**Soubor:** `apps/api/src/index.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
`/files/**` route servíruje jakýkoliv soubor z workspace directory, včetně `project.json`, `job.json`, log souborů a dalšího interního stavu. Toto je zbytečně permisivní.

**Doporučení:**
- Omezit statické servírování pouze na povolené podadresáře (proxy/, audio/, mask/)
- Explicitně blokovat přístup k `*.json` a `*.txt` souborům přes static handler

---

### SCALE-05: Audio extrakce vždy na plnou kvalitu

**Soubor:** `apps/api/src/services/ffmpegService.ts`
**Závažnost:** NÍZKÁ

**Popis:**
`extractAudio` vytváří WAV soubor na 48kHz stereo pro všechny assety. Pro beat detection by stačilo 22050Hz mono, což by bylo 4x menší a rychlejší.

**Doporučení:**
- Pro beat detection extrahovat 22050Hz mono
- Ponechat 48kHz stereo pouze pro finální audio mix

---

## 5. Kvalita kódu

### QUAL-01: Magic numbers v celém kódu

**Závažnost:** NÍZKÁ

**Popis:**
Číselné konstanty jsou roztroušeny napříč kódem bez pojmenování:
- `1500` (autosave delay) – `useProject.ts:48`
- `50` (history limit) – `useHistory.ts`
- `540` (proxy height) – `ffmpegService.ts`
- `48000` (sample rate) – `ffmpegService.ts`
- `3000` (polling interval) – `Editor.tsx:256`
- `20` (max log lines) – `routes/jobs.ts`

**Doporučení:**
- Vytvořit `constants.ts` v každém package s pojmenovanými konstantami
- Konfigurovatelné hodnoty přesunout do `config.ts`

---

### QUAL-02: Nekonzistentní error handling v API routes

**Závažnost:** NÍZKÁ

**Popis:**
Některé route handlery zachytávají chyby a vracejí `reply.code(500).send({error: ...})`, jiné nechávají chyby propagovat na Fastify default error handler. Formát chybových odpovědí není konzistentní.

**Doporučení:**
- Vytvořit centrální `AppError` class s HTTP status kódy
- Registrovat globální `app.setErrorHandler()` pro konzistentní formát chyb

---

### QUAL-03: Zbývající debug soubory v root adresáři

**Soubory:** `test_tiny.txt`, `test_write.txt`
**Závažnost:** NÍZKÁ

**Popis:**
Tyto soubory vypadají jako debug artefakty a nemají v repozitáři co dělat.

**Doporučení:**
- Smazat oba soubory
- Přidat do `.gitignore` pattern `test_*.txt`

---

### QUAL-04: Chybí explicitní ESLint konfigurace

**Závažnost:** NÍZKÁ

**Popis:**
Projekt spoléhá pouze na Next.js výchozí ESLint pravidla. Chybí pravidla pro:
- Zakázání `console.log` v produkci
- Vynucení React hooks pravidel
- Konzistentní import ordering

**Doporučení:**
- Přidat `.eslintrc.json` s `@typescript-eslint/recommended` a `react-hooks/rules-of-hooks`

---

### QUAL-05: Python scripty mají hardcodovaný model Whisper

**Soubor:** `scripts/align_lyrics.py`, `scripts/transcribe_lyrics.py`
**Závažnost:** NÍZKÁ

**Popis:**
Model size Whisper je hardcoded. Uživatelé nemohou přepínat mezi `tiny` (rychlý, méně přesný) a `large-v3` (pomalý, přesný) bez editace skriptu.

**Doporučení:**
- Přijímat model size jako CLI argument
- API route předá model jako parametr scriptu
- Expozovat v UI jako nastavení

---

### QUAL-06: Chybí frontend error boundaries

**Soubor:** `apps/web/src/components/Editor.tsx`
**Závažnost:** STŘEDNÍ

**Popis:**
Hlavní Editor komponenta nemá React Error Boundary. Pokud jakákoliv child komponenta vyhodí JavaScript výjimku (např. chyba v PreviewPipeline při renderování neočekávaného clipu), celá aplikace crashne na prázdnou bílou obrazovku.

**Doporučení:**
- Obalit hlavní komponenty do Error Boundary
- Zobrazit srozumitelnou chybovou hlášku s možností obnovení stavu

---

## 6. Mezery v testech

### TEST-01: Preview.tsx a Timeline.tsx nemají testy

**Závažnost:** VYSOKÁ

**Popis:**
Nejkritičtější komponenty editoru (2 081 a 2 199 řádků) nemají žádné unit ani integrační testy. Jakákoliv regrese v drag & drop, timeline snapping nebo canvas rendering není automaticky zachycena.

**Doporučení:**
- Extrahovat logiku do testovatelných hooků (`useTimelineDrag`, `useCanvasRenderer`)
- Napsat Vitest testy pro hookovou logiku
- Zvážit Playwright end-to-end testy pro UI interakce

---

### TEST-02: Editor.tsx nemá testy

**Závažnost:** VYSOKÁ

**Popis:**
Hlavní orchestrační komponenta (1 130 řádků) nemá žádné testy. Integrační chyby mezi Timeline, Preview, Inspector a useProject nejsou zachyceny.

**Doporučení:**
- Přidat integrační testy pro klíčové user flows (přidání clipu, export, undo/redo)

---

### TEST-03: PreviewPipeline nemá testy

**Soubor:** `apps/web/src/elements/PreviewPipeline.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
Canvas rendering pipeline pro preview nemá testy. Chyby v renderování různých typů clipů a efektů nejsou automaticky zachyceny.

**Doporučení:**
- Mockovat `CanvasRenderingContext2D` a testovat volání render metod
- Testovat, že správný clip element handler je zvolen pro každý clip typ

---

### TEST-04: Export integrační testy mockují FFmpeg

**Soubor:** `apps/api/src/__tests__/exportIntegration.test.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
Export testy mockují FFmpeg binárku. Real-world regrese v filter_complex syntaxi nebo v argumentech nejsou zachyceny.

**Doporučení:**
- Přidat end-to-end test s reálným FFmpeg (na CI s ffmpeg nainstalovaným)
- Testovat, že vygenerovaný filter_complex string je validní FFmpeg syntax

---

### TEST-05: Python scripty nemají testy

**Soubor:** `scripts/`
**Závažnost:** STŘEDNÍ

**Popis:**
Žádné ze 6 Python skriptů nemá pytest testy. Regrese v beat detection, lyrics alignment nebo cutout masking nejsou automaticky zachyceny.

**Doporučení:**
- Přidat `scripts/tests/` adresář s pytest testy
- Minimálně smoke testy s malými testovacími soubory

---

## 7. Bezpečnost

### SEC-01: `/files/**` servíruje i citlivé interní soubory

**Soubor:** `apps/api/src/index.ts`
**Závažnost:** STŘEDNÍ

**Popis:**
Static file handler na `/files/**` servíruje celý workspace adresář. Klient může requesty:
- `GET /files/projects/abc/project.json` – celá struktura projektu
- `GET /files/jobs/xyz/log.txt` – logy s cestami k souborům
- `GET /files/assets.json` – seznam všech assetů

**Doporučení:**
- Whitelist pouze specifické soubory/adresáře (proxy.mp4, audio.wav, waveform.json, mask.mp4)
- Nebo přidat route-level autorizaci pro citlivé soubory

---

### SEC-02: Chybí security headers

**Soubor:** `apps/api/src/index.ts`
**Závažnost:** NÍZKÁ

**Popis:**
API server nemá HTTP security headers (Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).

**Doporučení:**
- Přidat `@fastify/helmet` middleware
- Konfigurovat CSP pro statické soubory

---

### SEC-03: CORS origin je stringová konstanta bez validace

**Soubor:** `apps/api/src/config.ts`
**Závažnost:** NÍZKÁ

**Popis:**
`corsOrigin` proměnná přijímá libovolnou hodnotu z prostředí bez validace. Chybná konfigurace (např. `*`) může způsobit CORS bypass.

**Doporučení:**
- Validovat, že `CORS_ORIGIN` je validní URL nebo `*` je explicitně povoleno
- Logovat varování pokud je CORS nastaven na `*`

---

## 8. Dokumentace

### DOC-01: Chybí OpenAPI/Swagger specifikace

**Závažnost:** NÍZKÁ

**Popis:**
API nemá machine-readable specifikaci. Integrace vyžaduje čtení zdrojového kódu.

**Doporučení:**
- Použít Fastify JSON Schema validaci (HIGH-03) jako základ pro generování OpenAPI spec
- Přidat `@fastify/swagger` a `@fastify/swagger-ui`

---

### DOC-02: Chybí CONTRIBUTING.md

**Závažnost:** NÍZKÁ

**Popis:**
Není dokumentováno, jak přidat nový clip type nebo effect type. `docs/ARCHITECTURE.md` popisuje *co* je registry, ale ne konkrétní kroky jak rozšiřovat systém.

**Doporučení:**
- Napsat `docs/CONTRIBUTING.md` se step-by-step průvodcem:
  1. Jak přidat nový clip type
  2. Jak přidat nový effect type
  3. Jak přidat nový API endpoint
  4. Coding conventions

---

### DOC-03: Výkonnostní limity nejsou dokumentovány

**Závažnost:** NÍZKÁ

**Popis:**
Chybí dokumentace o tom, jakou projektovou komplexitu editor zvládne (max track count, max clip count, max duration, doporučená proxy rozlišení).

**Doporučení:**
- Přidat sekci "Performance Characteristics" do README.md
- Zdokumentovat doporučené limity pro plynulý zážitek

---

## Prioritizovaný backlog

| ID | Priorita | Odhadovaná náročnost | Status |
|----|----------|----------------------|--------|
| CRIT-01 | P0 | M | TODO |
| CRIT-02 | P0 | M | TODO |
| CRIT-03 | P0 | S | TODO |
| CRIT-04 | P0 | S | TODO |
| HIGH-01 | P1 | L | TODO |
| HIGH-02 | P1 | S | TODO |
| HIGH-03 | P1 | M | TODO |
| HIGH-04 | P1 | S | TODO |
| HIGH-05 | P1 | M | TODO |
| SEC-01 | P1 | S | TODO |
| ARCH-01 | P2 | L | TODO |
| ARCH-02 | P2 | M | TODO |
| ARCH-03 | P2 | M | TODO |
| ARCH-04 | P2 | XL | TODO |
| TEST-01 | P2 | L | TODO |
| TEST-02 | P2 | M | TODO |
| ARCH-05 | P2 | M | TODO |
| QUAL-06 | P2 | S | TODO |
| SCALE-01 | P3 | XL | TODO |
| SCALE-02 | P3 | S | TODO |
| SCALE-04 | P3 | S | TODO |
| ARCH-06 | P3 | S | TODO |
| QUAL-01 | P3 | S | TODO |
| QUAL-02 | P3 | M | TODO |
| QUAL-03 | P3 | XS | TODO |
| QUAL-04 | P3 | S | TODO |

**Legenda náročnosti:** XS = hodiny, S = 1 den, M = 2-3 dny, L = týden, XL = více týdnů

---

*Dokument vytvořen automatickou analýzou kódu. Aktualizujte při řešení každé položky.*
