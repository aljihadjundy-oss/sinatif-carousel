# AUDIT: Sinatif Carousel Generator → Editor Visual (Canva/Figma-class)

**Tanggal:** 2026-07-16
**Scope:** Audit read-only — tidak ada kode yang diubah.
**Konteks target:** Migrasi dari "generator satu-arah" ke "generator + editor visual" dengan
edit teks di kanvas (drag/resize/reposisi), font per elemen, tambah/hapus elemen,
background per slide, reorder/duplicate slide, dan undo/redo.

---

## 1. Arsitektur Render Saat Ini

**Kesimpulan singkat: 100% server-side image rendering via Satori (`next/og` `ImageResponse`). Tidak ada client-side canvas/DOM rendering sama sekali. Ini adalah gap arsitektur terbesar terhadap target editor interaktif.**

### Pipeline saat ini (end-to-end)

```
Topic + brand → /api/carousel/ideation (LLM)
             → /api/carousel/script-writer (LLM → JSONB script: {title, slides:[{index, headline, body}]})
             → /api/carousel/designer (route.tsx, ~643 baris)
                 ├─ resolveSlideDesign() + applyCustomColors()  (lib/slideDesign.ts)
                 ├─ renderSlide()  (lib/slide-renderer.tsx, ~1.967 baris)
                 │    └─ Satori/ImageResponse: JSX → PNG 1080×1350 per slide
                 ├─ Upload PNG ke Supabase Storage (carousel-assets/{postId}/slide-N.png)
                 └─ Persist carousel.slides (post_id, slide_order, copy_text, image_url)
Client (DesignWorkspace/SlideImage) → hanya <img src={publicUrl}> — PNG mati, tidak interaktif
```

### Implikasi untuk editor interaktif

- **Satori bukan engine yang bisa di-interaksikan.** Ia menerima JSX (subset flexbox), menghasilkan SVG→PNG, sekali jalan, di server. Tidak ada scene graph yang bisa di-hit-test, di-drag, atau di-select di browser.
- **Setiap perubahan sekecil apapun = full round-trip server** (regenerate → re-render semua slide → re-upload → refresh URL). Latensi per regenerate saat ini dalam hitungan detik per batch slide — tidak mungkin dipakai untuk drag 60fps.
- **Layout adalah kode, bukan data.** 9 template (`minimal`, `accent`, `editorial_gradient`, `flat_icon_list`, `flat_mockup_card`, `terminal_dev`, `elegant_promo`, `news_card`, `photo_editorial`) di-hardcode sebagai branch JSX raksasa di `lib/slide-renderer.tsx`. Posisi, ukuran, padding, dan z-order tiap elemen hidup di dalam kode template, tidak pernah ter-serialisasi.
- **Sisi positifnya:** `lib/slide-renderer.tsx` sudah sengaja dibuat *pure* (tanpa import Next-server-only), jadi ia bisa terus dipakai sebagai **export/render-to-PNG pipeline** di arsitektur baru — Satori tetap bagus untuk output final, hanya tidak bisa jadi editor.

---

## 2. Struktur Data Slide Saat Ini

### Skema (Supabase, schema `carousel` + `public`)

| Tabel/kolom | Isi | Granularitas |
|---|---|---|
| `carousel.posts.script` (JSONB) | `{title, slides:[{index, headline, body}]}` | **Per-slide, 2 field teks** |
| `carousel.posts.layout_variant, color_scheme, text_density, hierarchy, typography_preset, background_image_url, icon_name` | Opsi desain | **Post-level** |
| `carousel.posts.slide_overrides` (JSONB, migrasi 0011) | `[{slideIndex, colorScheme?, textDensity?, backgroundImageUrl?, layoutTemplate?, customColors?{fontColor,backgroundColor,shapeColor,iconColor}}]` | **Per-slide, per-kategori** |
| `carousel.slides` | `post_id, slide_order, copy_text, image_url` | Hasil render (cache), bukan sumber kebenaran desain |

### Verdict: **TIDAK cukup granular — perlu redesign ke model elemen-sebagai-objek**

Model saat ini adalah **"parameter tree"**: satu set knob global + array override per slide. Yang TIDAK bisa direpresentasikan:

- Posisi/ukuran/rotasi elemen individual (headline digeser 40px ke kanan? Tidak ada tempat menyimpannya.)
- Z-index / stacking order antar elemen.
- Elemen tambahan di luar cetakan template (text box kedua, shape bebas, sticker/icon lepas, gambar inline).
- Font per elemen (font saat ini per-brand + per-typography-preset, resolusi terjadi di render time).
- Multi-style dalam satu text box (bold sebagian kata, dsb.).
- Reorder/duplicate slide: `Slide.index` 1-based dipakai sebagai identitas di script JSONB, `slide_overrides.slideIndex`, `carousel.slides.slide_order`, dan nama file storage `slide-N.png`. Index-as-identity membuat reorder = re-index massal semua struktur paralel (sudah ada gejalanya: `reindexSlideOverrides()` harus dipanggil manual tiap kali slide count berubah).

### Rekomendasi data model baru (node tree ala Figma, versi minimal)

```typescript
interface SlideDocument {
  version: 1
  id: string                    // stable UUID — BUKAN index posisi
  canvas: { width: 1080; height: 1350; background: Fill }
  nodes: SlideNode[]            // urutan array = z-order
}

type SlideNode = TextNode | ShapeNode | ImageNode | IconNode

interface BaseNode {
  id: string
  type: string
  x: number; y: number; width: number; height: number
  rotation?: number
  opacity?: number
  locked?: boolean
}

interface TextNode extends BaseNode {
  type: 'text'
  text: string                  // (v2: rich runs untuk multi-style)
  fontFamily: string; fontWeight: number; fontSize: number
  color: string; align: 'left'|'center'|'right'; lineHeight: number
}
// ShapeNode: {shape:'rect'|'ellipse'|'line', fill, stroke, radius}
// ImageNode: {src, fit:'cover'|'contain', crop?}
// IconNode:  {name: IconName, color, strokeWidth}
```

- Simpan sebagai kolom JSONB baru, mis. `carousel.posts.slide_documents jsonb` (array of SlideDocument) — **JSONB fleksibel, tidak butuh migrasi struktural besar**, hanya kolom baru + `version` field untuk evolusi skema.
- **Template lama menjadi "compiler"**: fungsi `compileTemplate(layoutVariant, slideContent, resolvedDesign) → SlideDocument` yang menerjemahkan 9 template JSX ke node tree. Generate flow tetap sama dari sisi user; hasilnya sekarang *editable*.
- `script` + `slide_overrides` tetap ada sebagai input generator; `slide_documents` adalah hasil "materialize" yang jadi sumber kebenaran begitu user mulai mengedit. Perlu keputusan produk untuk kasus konflik: regenerate setelah edit manual = overwrite? merge? (rekomendasi: tandai slide "manually edited", regenerate skip slide itu kecuali dikonfirmasi).

---

## 3. Rekomendasi Library Interaktivitas

Tidak ada satupun library canvas/editor di `package.json` saat ini (React 18, Next 14, Tailwind, Supabase, sharp, jszip, LLM SDKs — itu saja).

> **Constraint (ditetapkan owner, Jul 2026): semua library baru HARUS gratis/open-source — no paid SDK.**
> Konsekuensi: **Polotno SDK keluar dari opsi** (berbayar). Saat fase 3 memilih antara
> react-konva (MIT) vs DOM + react-moveable (MIT), keduanya memenuhi syarat; tldraw
> perlu dicek lisensinya (SDK-license dengan watermark/ketentuan komersial) sebelum dipertimbangkan.
> Yang sudah dipakai fase 0–1 semuanya MIT: vitest, pixelmatch, pngjs.

### Perbandingan

| Opsi | Cocok? | Alasan |
|---|---|---|
| **Konva.js + react-konva** ⭐ rekomendasi | **Ya** | Deklaratif React (cocok dengan codebase yang full React), scene graph node-based yang map 1:1 ke data model di atas, `Transformer` bawaan untuk drag/resize/rotate handles, hit-testing, layering. Komunitas besar, TypeScript bagus. |
| Fabric.js | Bisa | Fitur editor paling lengkap out-of-the-box (inline text editing di canvas!), tapi imperative/OO — integrasi React lebih canggung (sinkronisasi state dua arah). Fabric v6 membaik tapi tetap "Fabric yang punya state", bukan React. |
| Custom DOM/HTML editor (absolutely-positioned divs + CSS transform) | Layak dipertimbangkan serius | Untuk kebutuhan carousel (teks + kotak + gambar, tanpa freehand/path editing), DOM editor + library kecil (`dnd-kit`/pointer events + `react-moveable` untuk handles) sering LEBIH sederhana daripada canvas: text editing native (contenteditable), font rendering identik browser, aksesibilitas gratis. Kelemahan: export harus lewat renderer terpisah (yang kebetulan **sudah dimiliki**: Satori server-side — atau `html-to-image` client-side). |
| Custom canvas engine dari nol | **Tidak** | Reinventing hit-testing, text layout, transform math — berbulan-bulan kerja tanpa nilai produk. |
| tldraw / Polotno SDK | Shortcut komersial | Polotno secara literal adalah "Canva SDK" (berbayar, berbasis Konva). Kalau time-to-market > kontrol, ini opsi tercepat. tldraw lisensinya perlu dicek untuk komersial. |

### Rekomendasi arsitektur render baru

```
                    ┌─ EDITOR (client): react-konva ATAU DOM+moveable
SlideDocument ──────┤     state: Zustand/useReducer + command log (undo/redo)
 (JSONB, source     │     autosave: debounced PATCH → Supabase
  of truth)         └─ EXPORT (server): renderDocument(SlideDocument) → Satori → PNG
                          (renderer baru yang membaca node tree, menggantikan
                           template-branch JSX; template lama jadi compiler)
```

Poin penting: **editor dan exporter membaca struktur data yang sama** (SlideDocument). Satori mendukung absolute positioning, jadi node tree `{x,y,width,height}` bisa dirender fidel — dengan satu risiko yang harus di-uji dini: **paritas text-wrapping** antara browser dan Satori (beda line-breaking engine → teks bisa wrap beda). Mitigasi: ukur teks di editor dengan font yang sama (font file sudah self-hosted di `public/fonts/` — modal bagus), fixed-size text box dengan overflow terlihat, dan snapshot test membandingkan render editor vs Satori.

Undo/redo: karena seluruh state slide adalah satu objek JSON, **command pattern atau snapshot stack sederhana** (immer patches / zundo untuk Zustand) sudah cukup — tidak perlu CRDT kecuali nanti mau kolaborasi realtime.

---

## 4. Technical Debt yang Akan Menghambat

Diurutkan dari yang paling menghambat:

1. **`lib/slide-renderer.tsx` = 1.967 baris monolit.** 9 template sebagai branch JSX dengan logika kontras/fallback ter-inline. Migrasi butuh tiap template dipecah jadi fungsi `compileTemplate()` yang menghasilkan data — ini pekerjaan terbesar dan paling rawan regresi visual. (Sudah ada modal: file ini pure dan sudah dipisah dari route.)
2. **Index-as-identity di mana-mana.** `slideIndex` 1-based menjadi kunci di 4 struktur paralel (script JSONB, slide_overrides, carousel.slides.slide_order, nama file `slide-N.png`). Reorder/duplicate slide mustahil bersih tanpa migrasi ke UUID per slide. `reindexSlideOverrides()` adalah plester di atas masalah ini.
3. **Regenerate = destroy & recreate total.** Designer route menghapus semua row `carousel.slides` + menimpa semua PNG tiap regenerate. Di dunia editor, ini harus jadi per-slide, incremental, dan tidak boleh menghancurkan hasil edit manual.
4. **Logika desain tersebar di 3 lapisan yang harus konsisten manual:** `DesignOptionsPanel`/`SlideCustomizeControl` (client, validasi + preview asumsi), designer route (validasi server: `HEX_COLOR_RE`, `LAYOUT_VARIANTS`, dsb.), dan renderer (kebenaran aktual). Metadata template (`LAYOUT_OPTIONS`, `imageOnly`, `recommendsImage`) baru saja mulai di-share — pola yang sama harus diteruskan, idealnya jadi satu registry template.
5. **Kontras otomatis vs kontrol manual.** Sistem kontras (PR #47 dst.: `getTextColorFromImage`, `getTextColorForBackground`) mengambil keputusan warna *di render time* per konteks. Di editor, keputusan ini harus terjadi *di compile time* (saat template → SlideDocument) lalu dibekukan sebagai properti node — kalau tidak, hasil editor dan hasil export bisa beda warna.
6. **Storage path & caching berbasis index** (`{postId}/slide-N.png`, `background-slide-N.jpg`) — perlu jadi content-addressed atau per-slide-UUID, dan URL publiknya di-cache-bust (sekarang upsert ke path sama).
7. **Tidak ada test otomatis sama sekali** (tidak ada test runner di package.json). Verifikasi selama ini via debug-route visual manual. Refactor sebesar ini tanpa snapshot/regression test = beresiko tinggi; minimal butuh visual snapshot test untuk 9 template sebelum mulai.
8. **Font resolution terkubur di renderer** (`BRAND_FONTS`, `typography-presets`, loader file lokal). Editor butuh font list + file yang sama tersedia di browser (`@font-face` dari `public/fonts/` — untungnya sudah self-hosted, tinggal diekspos).
9. Minor: `text_density` per-slide memicu LLM rewrite per regenerate (mahal/lambat, sudah dimitigasi memo per-request); dua interface `VisualStyle` duplikat (`lib/types.ts` vs `lib/slide-renderer.tsx`).

---

## 5. Estimasi Scope: Rewrite vs Refactor Incremental

**Verdict: refactor incremental yang besar — bukan rewrite total.** Yang berubah fundamental adalah *representasi slide* (kode→data) dan *tempat render interaktif* (server→client). Yang tetap dipakai: seluruh pipeline generate (ideation/script-writer), Supabase schema + storage + RLS, sistem kontras, font, brand profiles, dan Satori sebagai exporter.

### Fase yang disarankan

> **Status (Jul 2026):** Fase 0 selesai (PR #61 — 30 baseline snapshot visual, vitest+pixelmatch).
> Fase 1 selesai (PR ini — `slide_documents` JSONB + `lib/slideDocument.ts`). Fase 2+ menunggu approval owner.

| Fase | Isi | Perkiraan bobot relatif |
|---|---|---|
| **0. Safety net** | Visual snapshot test 9 template (pakai renderer pure yang sudah ada) | Kecil |
| **1. Data model** | `SlideDocument` schema + kolom JSONB + UUID per slide (fix debt #2) | Kecil–sedang |
| **2. Template compiler** | 9 template JSX → `compileTemplate() → SlideDocument`; renderer baru `renderDocument()` (Satori, absolute-positioned) + verifikasi paritas vs snapshot fase 0 | **Besar — jantung migrasi** |
| **3. Editor MVP** | Kanvas react-konva/DOM: select, drag, resize teks & elemen, edit teks inline, autosave | Besar |
| **4. Fitur editor** | Font per elemen, tambah/hapus elemen, background per slide (sebagian sudah ada), reorder/duplicate (butuh fase 1), undo/redo | Sedang |
| **5. Rekonsiliasi generate↔edit** | Kebijakan regenerate vs slide yang sudah diedit manual; deprecate bertahap `slide_overrides` UI (digantikan editor langsung) | Sedang |

Kasarnya ini setara **beberapa kali lipat total usaha seri per-slide-override yang baru selesai** (PR #52–#59), dengan fase 2 sebagai risiko jadwal terbesar.

### Risk list

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | **Text-wrap mismatch editor vs Satori export** — "what you see ≠ what you download" | Tinggi (merusak kepercayaan pada editor) | Font identik self-hosted; fixed text box; snapshot diff test editor-vs-export sejak fase 2; fallback: export client-side (`html-to-image`) bila paritas Satori tak tercapai |
| R2 | Regresi visual saat template → compiler (9 template × banyak kombinasi warna/gambar/density) | Tinggi | Fase 0 wajib sebelum fase 2; migrasi satu template dulu (mis. `minimal`) end-to-end sebagai pilot |
| R3 | Konflik regenerate vs edit manual (LLM menimpa kerja user) | Tinggi (data loss dari sudut pandang user) | Flag `manuallyEdited` per slide; regenerate default skip slide ter-edit |
| R4 | Migrasi data post lama (belum punya `slide_documents`) | Sedang | Lazy materialization: compile on first open di editor, bukan migrasi batch |
| R5 | Scope creep ke fitur Figma penuh (path editing, komponen, kolaborasi) | Sedang | Kunci scope ke daftar fitur di brief; CRDT/kolaborasi eksplisit out-of-scope |
| R6 | Performa kanvas di mobile (target user kemungkinan edit dari HP) | Sedang | Konva/DOM keduanya oke untuk <50 node per slide; uji dini di device nyata |
| R7 | Kontras otomatis "membeku" salah saat compile (mis. user ganti gambar setelah compile) | Rendah–sedang | Jalankan ulang util kontras sebagai *saran* (bukan paksaan) saat user mengganti background di editor — util `lib/contrast.ts` sudah reusable |
| R8 | Dua sumber kebenaran selama masa transisi (`slide_overrides` vs `slide_documents`) | Sedang | Aturan tegas: begitu post punya `slide_documents`, overrides read-only/diabaikan; UI lama disembunyikan untuk post ter-migrasi |

---

## Ringkasan Rekomendasi

1. **Adopsi model data node-tree (`SlideDocument`)** sebagai sumber kebenaran baru, disimpan JSONB; slide dan node ber-UUID, bukan ber-index.
2. **Ubah 9 template menjadi compiler** yang menghasilkan `SlideDocument`; tulis `renderDocument()` (Satori) untuk export — Satori tetap dipakai, tapi turun jabatan dari "satu-satunya renderer" jadi "exporter".
3. **Editor client-side dengan react-konva** (atau DOM + react-moveable jika inline text editing diprioritaskan) + Zustand + undo/redo berbasis snapshot/patch.
4. **Kerjakan incremental dengan safety net**: snapshot test dulu, pilot satu template, baru sisanya.
5. **Jangan bangun canvas engine sendiri**, dan pertimbangkan Polotno SDK jika kecepatan rilis lebih penting daripada kontrol penuh.
