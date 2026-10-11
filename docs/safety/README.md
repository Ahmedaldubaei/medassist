# Safety policy documents — MedAssist

## Authoritative documents (v2.0-draft)

| File | Description | Status |
|---|---|---|
| `MedAssist-Safety-Rules-Final.md` | Safety policy v2.0-draft (behavioral + operational rules) | **DRAFT — pending clinical review. NOT clinically approved.** |
| `MedAssist-Safety-Test-Plan-Final.md` | Safety verification test plan v1.0-draft | **DRAFT — pending clinical review. NOT clinically approved.** |

These two `*-Final.md` files are the authoritative policy sources and **supersede**
the older summary below. Deterministic requirements from the policy (§4.1, §7, §9.3,
§10, §12) are implemented in `apps/api/src/agents/router.ts` and `safety.ts`
with unit tests referencing the test-plan IDs (E-*, D-*, G-*, S-*).

## Superseded

| File | Description | Status |
|---|---|---|
| `MedAssist-Safety-Rules.md` | Older Arabic summary of the safety gate | **Superseded** by the v2.0-draft policy above. Kept for reference only. |

## Important notices

- **Draft status:** the v2.0 policy and test plan are proposals for engineering and
  clinical review. They are NOT clinical approvals, certifications, or evidence of
  readiness for clinical use (§14 of the policy lists the launch acceptance criteria).
- **Traceability:** safety decisions recorded in `safetyReview.checksJson` carry
  `policyVersion: '2.0-draft'` (policy §11).
- **Test coverage mapping:** see the report back to the parent agent / test files
  `apps/api/tests/agents-router.test.ts`, `agents-safety.test.ts`,
  `redteam-injection.test.ts` for which test-plan IDs are automated vs manual.
