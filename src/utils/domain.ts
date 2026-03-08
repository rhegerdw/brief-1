import { getDomain, parse } from "tldts";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com","yahoo.com","outlook.com","hotmail.com","aol.com","icloud.com","protonmail.com","pm.me","me.com","live.com","msn.com","ymail.com","gmx.com","zoho.com","yandex.com","mail.com"
]);

export function normalizeDomain(input?: string | null): string | null {
  if (!input) return null;
  let v = input.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  // Strip path if any
  v = v.split("/")[0];
  // If someone pasted email, take part after @
  const at = v.lastIndexOf("@");
  if (at >= 0) v = v.slice(at + 1);
  const root = getDomain(v) || v.toLowerCase();
  return root || null;
}

export function isFreeEmailDomain(domain?: string | null): boolean {
  if (!domain) return false;
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// Heuristic: true when domain looks like a company's own site, not a directory/social
export function isLikelyCompanyWebsite(domain?: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (!d || !d.includes('.')) return false;
  if (isFreeEmailDomain(d)) return false;
  const banned = new Set([
    'linkedin.com','lnkd.in','facebook.com','instagram.com','x.com','twitter.com','t.co','youtube.com','youtu.be',
    'wikipedia.org','crunchbase.com','angel.co','glassdoor.com','indeed.com','g2.com','capterra.com','medium.com',
    'substack.com','linktr.ee','about.me','notion.site','google.com','sites.google.com','apple.com'
  ]);
  if (banned.has(d)) return false;
  // tldts getDomain already normalized; reject obviously generic subdomains
  const genericSub = ['sites.google.com'];
  if (genericSub.some((g) => d.endsWith(g))) return false;
  // Looks fine
  return true;
}

/**
 * Parse domain from a transcript title using naming convention: "domain.com - anything"
 * Also handles: "domain.com", "domain.com anything", "Company Name - domain.com"
 * Returns null if no valid domain pattern found
 */
export function parseDomainFromTitle(title?: string | null): string | null {
  if (!title) return null;
  const t = title.trim();

  // Pattern 1: "domain.com - description" (preferred)
  const dashMatch = t.match(/^([a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\.[a-z]{2,})?)\s*-/i);
  if (dashMatch) {
    const candidate = normalizeDomain(dashMatch[1]);
    if (candidate && isLikelyCompanyWebsite(candidate)) return candidate;
  }

  // Pattern 2: "Company Name - domain.com" (domain at end)
  const endMatch = t.match(/-\s*([a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\.[a-z]{2,})?)\s*$/i);
  if (endMatch) {
    const candidate = normalizeDomain(endMatch[1]);
    if (candidate && isLikelyCompanyWebsite(candidate)) return candidate;
  }

  // Pattern 3: Just "domain.com" (whole title is domain)
  const wholeMatch = t.match(/^([a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\.[a-z]{2,})?)$/i);
  if (wholeMatch) {
    const candidate = normalizeDomain(wholeMatch[1]);
    if (candidate && isLikelyCompanyWebsite(candidate)) return candidate;
  }

  // Pattern 4: "domain.com something" (domain at start, space-separated)
  const startMatch = t.match(/^([a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\.[a-z]{2,})?)\s+/i);
  if (startMatch) {
    const candidate = normalizeDomain(startMatch[1]);
    if (candidate && isLikelyCompanyWebsite(candidate)) return candidate;
  }

  return null;
}

export function humanizeOrgFromDomain(input?: string | null): string | null {
  const d = normalizeDomain(input || null);
  if (!d) return null;
  let label = d.replace(/^www\./i, "");
  try {
    const info = parse(label);
    if (info && info.domainWithoutSuffix) label = info.domainWithoutSuffix;
    else label = label.split(".")[0] || label;
  } catch {
    label = label.split(".")[0] || label;
  }
  label = label.trim();
  if (!label) return null;

  // If hyphens/underscores exist, split on them directly
  const directParts = label.split(/[-_]+/).filter(Boolean);
  let parts: string[] = directParts.length > 1 ? directParts : [];

  // Greedy segmentation over a small business-word dictionary
  if (!parts.length) {
    const s = label.toLowerCase();
    const dict = new Set([
      'service','services','pro','roof','roofing','hvac','plumb','plumbing','msp','it','tech','group','capital','partners','solutions','systems','labs','health','healthcare','care','clinic','dental','medical','property','management','industrial','manufacturing','mfg','distribution','logistics','supply','construction','contractors','landscaping','restoration','security','cyber','cybersecurity','software','saas','vertical','b2b','advisors','advisory','consulting','marketing','media','data','analytics','ai','robotics','energy','power','utilities','flooring','painting','cleaning','janitorial','pool','tree','garage','doors','auto','glass','fence','pest','control'
    ]);
    const acronyms = new Set(['msp','it','ai','b2b','saas']);
    const out: string[] = [];
    let i = 0;
    while (i < s.length) {
      let found = '';
      // try longest token up to 12 chars
      for (let L = Math.min(12, s.length - i); L >= 2; L--) {
        const cand = s.slice(i, i + L);
        if (dict.has(cand)) { found = cand; break; }
      }
      if (found) {
        out.push(found);
        i += found.length;
      } else {
        // accumulate until next match or break on vowel-consonant boundary heuristic
        let j = i + 1;
        while (j < s.length) {
          const maybe = (() => {
            for (let L = Math.min(12, s.length - j); L >= 2; L--) {
              if (dict.has(s.slice(j, j + L))) return true;
            }
            return false;
          })();
          if (maybe) break;
          j++;
        }
        out.push(s.slice(i, j));
        i = j;
      }
    }
    parts = out.filter(Boolean);
    // Merge very short fragments with neighbors
    const merged: string[] = [];
    for (const p of parts) {
      if (merged.length && p.length <= 2 && merged[merged.length - 1].length <= 2) {
        merged[merged.length - 1] = merged[merged.length - 1] + p;
      } else merged.push(p);
    }
    parts = merged;
    // Uppercase acronyms
    parts = parts.map((p) => (acronyms.has(p) ? p.toUpperCase() : p));
  }

  // Title Case tokens (keep acronyms)
  const titled = parts.map((p) => (p === p.toUpperCase() ? p : p.charAt(0).toUpperCase() + p.slice(1)));
  return titled.join(' ').trim() || null;
}
