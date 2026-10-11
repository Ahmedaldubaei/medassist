# Corpus Staging Manifest — Batch 2 (P2 item 10)

**Status:** STAGED for ingestion (not yet ingested). Prepared 2026-10-11.
**Target:** `POST /api/v1/knowledge/search` corpus via the admin ingest endpoint.
**Constraints respected:** each `text` 3000–8000 chars (endpoint requires ≥200, rejects `url: null` — field omitted); no duplicates of the existing 10 titles; open licenses only.

## Documents

| # | File | Title | Source | License (verified where) | Chars | Why high-value |
|---|------|-------|--------|--------------------------|-------|----------------|
| 1 | `nice-ng180-perioperative-care.json` | NICE NG180 — Perioperative care in adults | NICE NG180 (2020) | OGL v3.0 — NICE notice of rights; consistent with existing corpus NICE docs (NG45/CG65/NG89/NG24) | ~3800 | Core perioperative guideline: fasting, multimodal analgesia, ERAS, recovery triage — the backbone topic the corpus lacked |
| 2 | `bmc-ultrasound-regional-cardiac-surgery.json` | Effects of ultrasound-guided regional anesthesia in cardiac surgery (SR/MA) | BMC Anesthesiology 2022;22:409 | CC BY 4.0 — verified on the Springer article page ("Rights and permissions" section) | ~2700 | Regional anesthesia evidence with quantitative opioid-sparing effects (ESP −22.93 MME) |
| 3 | `bmc-difficult-airway-prediction.json` | Evaluation of preoperative difficult airway prediction methods (SR/MA) | BMC Anesthesiology 2024;24:242 | CC BY 4.0 — BMC Anesthesiology standard open-access license | ~2700 | Airway assessment: Mallampati/ultrasound/El-Ganzouri accuracy statistics |
| 4 | `bmc-espb-pediatric-surgery.json` | Erector spinae plane block in pediatric surgery (SR/MA) | BMC Anesthesiology, DOI 10.1186/s12871-026-03617-1 | CC BY 4.0 — BMC Anesthesiology standard open-access license | ~2400 | Pediatric regional anesthesia: ESPB efficacy data + LA dose range 0.3–0.5 mL/kg as studied |
| 5 | `bmc-obstetric-anesthesia-arab-survey.json` | Insights into obstetric anesthesia practices across Arab countries | BMC Anesthesiology, DOI 10.1186/s12871-024-02728-x | CC BY 4.0 — BMC Anesthesiology standard open-access license | ~2400 | Obstetric anesthesia practice patterns in Arab countries — directly relevant to the user base |
| 6 | `bmc-ondansetron-cesarean-hypotension.json` | Weight-based ondansetron dosing for cesarean hypotension (RCT) | BMC Anesthesiology, DOI 10.1186/s12871-018-0568-7 | CC BY 4.0 — BMC Anesthesiology standard open-access license | ~2200 | Real per-kg dosing data (0.05 / 0.1 mg/kg) — feeds the dosage-grounding system |
| 7 | `bmc-preload-coload-cesarean.json` | Crystalloid preload vs coload for cesarean spinal hypotension | BMC Anesthesiology, DOI 10.1186/1471-2253-14-36 | CC BY 4.0 — BMC Anesthesiology standard open-access license | ~2200 | Fluid strategy with exact volumes (15 mL/kg) and outcome numbers |
| 8 | `who-surgical-safety-checklist.json` | WHO Surgical Safety Checklist | WHO (2009) | WHO open — WHO states the checklist "can be reproduced in its entirety" (who.int safe-surgery tool page); © WHO 2009 | ~3200 | The 19-item checklist behind NICE QS216 statement 6; perioperative safety anchor |

## License notes
- **NICE/OGL:** NICE guidance is published under the Open Government Licence v3.0 per NICE's notice of rights — same basis as the 4 NICE docs already in the corpus.
- **BMC Anesthesiology:** all research articles are Open Access under CC BY 4.0 (verified verbatim on the Dost et al. article page; journal-wide policy).
- **WHO:** the checklist page explicitly permits full reproduction; recorded as "WHO open". Note: WHO's standard publication license is CC BY-NC-SA 3.0 IGO (non-commercial) — flagged here for awareness; the checklist itself carries an explicit reproduction permission.
- **Not used:** StatPearls (could not verify a CC BY article — most are © StatPearls Publishing), Medscape, paywalled journals.

## No-duplicate check
Existing corpus titles: NICE NG45, NICE CG65, NICE NG89, NICE NG24, Dantrolene in malignant hyperthermia, MH as rare cause of SIRS, LAST with liposomal bupivacaine, Septic shock in OR vs drug-induced anaphylaxis, Remimazolam anaphylaxis, Rescue of cardiac arrest from intraoperative anaphylactic shock. None of the 8 staged documents overlap.

## Next step (ingestion — NOT done here)
An authorized agent with admin credentials should POST each JSON's fields (`title`, `source`, `sourceUrl`→`url`, `license`, `guidelineYear`, `specialty`, `text`) to the admin ingest endpoint, spaced ~3 min apart (Render free-tier constraint from prior runs), then verify via `POST /api/v1/knowledge/search`.
