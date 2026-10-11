/**
 * Curated clinical seed data — built EXCLUSIVELY from the ingested corpus.
 *
 * SAFETY CONTRACT (non-negotiable):
 * - Every step/entry carries a citation {title, source} to a real corpus document.
 * - NEVER invent dosages, steps, or facts from model knowledge.
 * - Where the corpus lacks a fact (e.g. standard mg/kg protocols), the step
 *   text says so explicitly via UNAVAILABLE_* constants — the UI renders it
 *   as "غير متوفر في المراجع الحالية".
 *
 * Sources (all ingested in the production corpus):
 * - MH1: "Dantrolene in the treatment of malignant hyperthermia: a case report"
 *         (BMC Anesthesiology 2014, CC BY 4.0)
 * - MH2: "Malignant hyperthermia as a rare cause of SIRS after cardiac surgery"
 *         (BMC Anesthesiology 2014, CC BY 4.0)
 * - LAST: "Local anesthetic systemic toxicity with liposomal bupivacaine:
 *          a case series and literature review" (BMC Anesthesiology 2026, CC BY-NC-ND 4.0)
 * - ANA: "Septic shock in the operating room immediately after surgery: a case
 *          requiring differentiation from drug-induced anaphylaxis"
 *          (BMC Anesthesiology 2026, CC BY 4.0)
 */

export interface Citation {
  title: string;
  source: string;
}

export interface ChecklistStep {
  textAr: string;
  textEn: string;
  citation: Citation;
  /** True when the corpus does NOT contain this fact — UI shows "unavailable". */
  unavailable?: boolean;
}

export interface ChecklistSeed {
  key: string;
  titleAr: string;
  titleEn: string;
  category: string;
  steps: ChecklistStep[];
}

export interface DrugEntry {
  indicationAr: string;
  indicationEn: string;
  /** Documented dose string, or null when the corpus has no dose. */
  dose: string | null;
  route: string | null;
  notesAr: string | null;
  notesEn: string | null;
  /** per-kg dosing for the calculator — null when not documented in corpus. */
  perKg: { min: number; max: number; unit: string } | null;
  citation: Citation;
}

export interface DrugSeed {
  nameAr: string;
  nameEn: string;
  classAr: string | null;
  entries: DrugEntry[];
}

const MH1: Citation = {
  title: 'Dantrolene in the treatment of malignant hyperthermia: a case report',
  source: 'BMC Anesthesiology 2014 (CC BY 4.0)',
};
const MH2: Citation = {
  title: 'Malignant hyperthermia as a rare cause of SIRS after cardiac surgery',
  source: 'BMC Anesthesiology 2014 (CC BY 4.0)',
};
const LAST: Citation = {
  title:
    'Local anesthetic systemic toxicity with liposomal bupivacaine: a case series and literature review',
  source: 'BMC Anesthesiology 2026 (CC BY-NC-ND 4.0)',
};
const ANA: Citation = {
  title:
    'Septic shock in the operating room immediately after surgery: a case requiring differentiation from drug-induced anaphylaxis',
  source: 'BMC Anesthesiology 2026 (CC BY 4.0)',
};

export const CHECKLISTS: ChecklistSeed[] = [
  {
    key: 'malignant-hyperthermia',
    titleAr: 'فرط الحرارة الخبيث',
    titleEn: 'Malignant Hyperthermia',
    category: 'emergency',
    steps: [
      {
        textAr:
          'أوقف المحفزات فورًا: السكساميثونيوم والعوامل الاستنشاقية المتطايرة (في الحالة الموثقة: سكساميثونيوم 100mg وديسفلوران).',
        textEn:
          'Stop triggers immediately: suxamethonium and volatile agents (documented case: suxamethonium 100mg and desflurane).',
        citation: MH1,
      },
      {
        textAr:
          'أعطِ دانترولين وريديًا: في الحالة الموثقة أُعطي 380mg عند التشخيص، ثم 200mg تسريبًا على ساعتين عند الانتكاس (المجموع 580mg = 29 قارورة).',
        textEn:
          'Give IV dantrolene: documented case used 380mg at diagnosis, then 200mg infusion over 2h for recrudescence (total 580mg = 29 vials).',
        citation: MH1,
      },
      {
        textAr:
          'زد التهوية الدقيقة وأعطِ أكسجين 100%: في الحالة الموثقة رُفعت التهوية إلى 12 لترًا وبـ FiO2 100%.',
        textEn:
          'Increase minute ventilation and give 100% oxygen: documented case raised ventilation to 12 litres at FiO2 100%.',
        citation: MH1,
      },
      {
        textAr:
          'برّد المريض: سوائل وريدية باردة (رينجر أسيتات بارد في الحالة الموثقة) + تبريد سطحي بالثلج.',
        textEn:
          'Cool the patient: cold IV fluids (cold Ringer acetate in the documented case) + surface cooling with ice.',
        citation: MH1,
      },
      {
        textAr:
          'راقب الانتكاس: يحدث في 23% من الحالات رغم العلاج المناسب — في الحالة الموثقة حدث انتكاس خفيف بعد ~6 ساعات (هبوط pH من 7.43 إلى 7.31 وارتفاع pCO2).',
        textEn:
          'Watch for recrudescence: occurs in 23% despite appropriate management — documented case relapsed mildly at ~6h (pH 7.43→7.31, rising pCO2).',
        citation: MH1,
      },
      {
        textAr:
          'علامات التشخيص الموثقة: ارتفاع pCO2 (10 kPa في الحالة)، تعرق، ارتفاع الحرارة (35.5 → 38.9°C)، صلابة عضلية، حماض استقلابي، ارتفاع CK.',
        textEn:
          'Documented diagnostic signs: rising pCO2 (10 kPa in the case), sweating, rising temperature (35.5 → 38.9°C), muscle rigidity, metabolic acidosis, raised CK.',
        citation: MH1,
      },
      {
        textAr: 'الجرعة المعيارية للدانترولين (mg/kg): غير متوفرة في المراجع الحالية.',
        textEn: 'Standard weight-based dantrolene dosing (mg/kg): not available in the current references.',
        citation: MH1,
        unavailable: true,
      },
    ],
  },
  {
    key: 'anaphylaxis',
    titleAr: 'التأق (الحساسية المفرطة)',
    titleEn: 'Anaphylaxis',
    category: 'emergency',
    steps: [
      {
        textAr:
          'أوقف الدواء المشتبه فورًا: في الحالة الموثقة حدث هبوط الضغط بعد دقيقة من إعطاء سوغاماديكس 200mg وريديًا.',
        textEn:
          'Stop the suspected drug immediately: documented case crashed ~1 minute after 200mg IV sugammadex.',
        citation: ANA,
      },
      {
        textAr:
          'أعطِ أدرينالين: في الحالة الموثقة بدأ bolus أدرينالين ثم تسريب مستمر مع النقل للعناية المركزة.',
        textEn:
          'Give adrenaline: documented case started an adrenaline bolus followed by continuous infusion with ICU transfer.',
        citation: ANA,
      },
      {
        textAr:
          'ادعم الدورة الدموية: سوائل وريدية + قابضات أوعية (في الحالة: إفيدرين، فينيليفرين، نورأدرينالين) — العلامات: ضغط انقباضي ~70 mmHg واحمرار معمم.',
        textEn:
          'Support circulation: IV fluids + vasopressors (case used ephedrine, phenylephrine, noradrenaline) — signs: SBP ~70 mmHg and generalized erythema.',
        citation: ANA,
      },
      {
        textAr:
          'قس التربتاز (tryptase) في 30 دقيقة وساعتين و24 ساعة + الهيستامين — في الحالة الموثقة كانت طبيعية (2.5، 3.1، 1.9 µg/L) مما ساعد على الاستبعاد.',
        textEn:
          'Measure tryptase at 30 min, 2h and 24h + histamine — documented case was normal (2.5, 3.1, 1.9 µg/L), aiding exclusion.',
        citation: ANA,
      },
      {
        textAr:
          'فرّق عن الإنتان: ارتفاع اللاكتات (3.9 mmol/L في الحالة)، البروكالسيتونين، ومزارع الدم (Klebsiella في الحالة) — الإنتان سبب شائع للصدمة التوزيعية.',
        textEn:
          'Differentiate from sepsis: rising lactate (3.9 mmol/L in the case), procalcitonin, blood cultures (Klebsiella in the case) — sepsis is a common distributive shock cause.',
        citation: ANA,
      },
      {
        textAr: 'جرعة الأدرينالين الدقيقة (bolus/infusion): غير متوفرة في المراجع الحالية.',
        textEn: 'Exact adrenaline dosing (bolus/infusion): not available in the current references.',
        citation: ANA,
        unavailable: true,
      },
    ],
  },
  {
    key: 'last',
    titleAr: 'سمية المخدر الموضعي الجهازية (LAST)',
    titleEn: 'Local Anesthetic Systemic Toxicity (LAST)',
    category: 'emergency',
    steps: [
      {
        textAr:
          'أوقف حقن المخدر الموضعي وتجنب الحقن داخل الأوعية: اسحب (aspirate) بعناية قبل الحقن وقلل الجرعة في المناطق عالية التروية.',
        textEn:
          'Stop local anesthetic injection and avoid intravascular injection: aspirate carefully and reduce dose in highly vascular areas.',
        citation: LAST,
      },
      {
        textAr:
          'أعطِ مستحلب الدهون الوريدي مبكرًا عند أي اشتباه: في الحالات الموثقة أدى إلى تحسن عصبي خلال 5 دقائق وفك التنبيب بعد ساعتين.',
        textEn:
          'Give IV lipid emulsion EARLY on any suspicion: documented cases improved neurologically within 5 minutes, extubated after 2 hours.',
        citation: LAST,
      },
      {
        textAr:
          'تعرف على العلامات: هياج، نظرة ثابتة، توتر عضلي متزايد، ثم توقف قلب ورجفان بطيني متكرر (الحالات: 266mg بوبيفاكين شحمي).',
        textEn:
          'Recognize the signs: agitation, fixed gaze, increased muscle tone, then cardiac arrest with recurrent VF (cases: 266mg liposomal bupivacaine).',
        citation: LAST,
      },
      {
        textAr:
          'تذكر أن سمية البوبيفاكين الشحمي قد تكون متأخرة: الحالة الثانية ظهرت عند الوصول لـ PACU — راقب المريض لفترة ممتدة.',
        textEn:
          'Remember liposomal bupivacaine toxicity can be delayed: case 2 presented on PACU arrival — observe the patient for a prolonged period.',
        citation: LAST,
      },
      {
        textAr: 'جرعة مستحلب الدهون الدقيقة (bolus/infusion): غير متوفرة في المراجع الحالية.',
        textEn: 'Exact lipid emulsion dosing (bolus/infusion): not available in the current references.',
        citation: LAST,
        unavailable: true,
      },
    ],
  },
];

export const DRUGS: DrugSeed[] = [
  {
    nameAr: 'دانترولين',
    nameEn: 'Dantrolene',
    classAr: 'مرخي عضلي مباشر — علاج فرط الحرارة الخبيث',
    entries: [
      {
        indicationAr: 'فرط الحرارة الخبيث (جرعات من تقرير حالة موثق — ليست بروتوكولًا معياريًا)',
        indicationEn: 'Malignant hyperthermia (case-report dosing — not a standard protocol)',
        dose: '380 mg IV at diagnosis; 200 mg infusion over 2h for recrudescence (total 580 mg = 29 vials)',
        route: 'IV',
        notesAr:
          'هذه جرعات حالة واحدة موثقة (شاب 19 سنة). الجرعة المعيارية حسب الوزن غير موجودة في المراجع الحالية.',
        notesEn:
          'Single documented case doses (19-year-old male). Standard weight-based dosing is not in the current references.',
        perKg: null,
        citation: MH1,
      },
    ],
  },
  {
    nameAr: 'مستحلب الدهون الوريدي 20%',
    nameEn: 'Intravenous Lipid Emulsion 20%',
    classAr: 'علاج الإنقاذ لسمية المخدر الموضعي الجهازية',
    entries: [
      {
        indicationAr: 'سمية المخدر الموضعي الجهازية (LAST)',
        indicationEn: 'Local anesthetic systemic toxicity (LAST)',
        dose: null,
        route: 'IV',
        notesAr:
          'المرجع يوصي بالإعطاء المبكر عند أي اشتباه (تحسن خلال 5 دقائق في الحالات الموثقة). الجرعة الدقيقة غير موجودة في المراجع الحالية.',
        notesEn:
          'Reference recommends early administration on any suspicion (improvement within 5 min in documented cases). Exact dosing is not in the current references.',
        perKg: null,
        citation: LAST,
      },
    ],
  },
];
