/**
 * Domain blocklists, low-trust lists, and content caps.
 * Ported faithfully from the original meetingbrief pipeline.
 */

/**
 * Domains we never scrape or cite. Mostly social platforms, data brokers,
 * and personal-information aggregators that pollute briefs.
 */
export const BLOCKED_DOMAINS: ReadonlySet<string> = new Set([
  // Social / personal
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'reddit.com',
  'old.reddit.com',
  'quora.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'snapchat.com',
  'threads.net',
  'mastodon.social',

  // People-search / data brokers
  'spokeo.com',
  'whitepages.com',
  'beenverified.com',
  'truepeoplesearch.com',
  'fastpeoplesearch.com',
  'peoplefinders.com',
  'mylife.com',
  'radaris.com',
  'intelius.com',
  'instantcheckmate.com',
  'peekyou.com',
  'usphonebook.com',
  'addresses.com',
  'zabasearch.com',
  'familytreenow.com',
  'usa-people-search.com',
  'classmates.com',

  // Fluffy aggregators
  'wikitree.com',
  'ancestry.com',
  'findagrave.com',
  'genealogy.com',

  // Job-board noise
  'indeed.com',
  'glassdoor.com',
  'monster.com',
  'ziprecruiter.com',
]);

/**
 * Low-trust domains: contact/profile aggregators that often have fabricated or
 * stale info. We only cite these if no better source exists.
 */
export const LOW_TRUST_DOMAINS: ReadonlySet<string> = new Set([
  'zoominfo.com',
  'rocketreach.co',
  'rocketreach.com',
  'apollo.io',
  'signalhire.com',
  'contactout.com',
  'lusha.com',
  'usebouncer.com',
  'leadiq.com',
  'salesintel.io',
  'datanyze.com',
  'crunchbase.com',
  'pitchbook.com',
  'owler.com',
  'theorg.com',
  'slintel.com',
  'thedirectory.org',
]);

export const MAX_CONTENT_PER_SOURCE = 3500;
export const MAX_SOURCES_TO_LLM = 15;

/** Snippet priority threshold for the first scrape wave (critical sources). */
export const WAVE1_MIN_PRIORITY = 7;
/** Snippet priority threshold for the second scrape wave (medium sources). */
export const WAVE2_MIN_PRIORITY = 4;

/** Soft cap for total scraped sources before truncating to MAX_SOURCES_TO_LLM. */
export const MAX_SCRAPE_TARGETS = 18;
