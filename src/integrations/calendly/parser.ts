export type CalendlyQA = { question: string; answer: string };

export function extractIndustryKey(qas: CalendlyQA[]): string | null {
  const target = qas.find((q) => /Industry\s*\/\s*Business\s*Type/i.test(q.question));
  if (!target) return null;
  const val = (target.answer || "").trim().toLowerCase();
  const map: Record<string, string> = {
    "roofing / home services": "roofing",
    roofing: "roofing",
    hvac: "hvac",
    plumbing: "plumbing",
    manufacturing: "manufacturing",
    distribution: "distribution",
    industrial: "industrial",
    "msp / it services": "msp",
    msp: "msp",
    cybersecurity: "cybersecurity",
    "dental / healthcare": "healthcare",
    healthcare: "healthcare",
    counseling: "healthcare_services",
    therapy: "healthcare_services",
    "mental health": "healthcare_services",
    healthcare_services: "healthcare_services",
    healthcare_tech: "healthcare_tech",
    construction: "construction",
    landscaping: "landscaping",
    restoration: "restoration",
    property_management: "property_management",
    trades_services: "trades_services",
    vertical_saas: "vertical_saas",
    b2b_services: "b2b_services",
    other: "other",
  };
  return map[val] ?? null;
}

export function extractCompanyName(qas: CalendlyQA[]): string | null {
  const patterns = [
    /company\s*name/i,
    /company\s*\/\s*organization/i,
    /organization\s*name/i,
    /business\s*name/i,
  ];
  for (const p of patterns) {
    const target = qas.find((q) => p.test(q.question));
    if (target && target.answer) {
      const v = target.answer.trim();
      if (v) return v;
    }
  }
  return null;
}

export function extractWebsite(qas: CalendlyQA[]): string | null {
  const patterns = [
    /website\s*\/\s*domain/i,
    /company\s*website/i,
    /website/i,
    /domain/i,
  ];
  for (const p of patterns) {
    const target = qas.find((q) => p.test(q.question));
    if (target && target.answer) {
      const v = target.answer.trim();
      if (v) return v;
    }
  }
  return null;
}
