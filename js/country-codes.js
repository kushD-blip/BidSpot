/* js/country-codes.js — countries and their dial codes.
   Single source for the phone-country picker AND the billing-country dropdown, so
   the two can never fall out of sync. Small (top ~40) rather than every country
   on earth — the checkout dropdown is used in the last mile of a payment flow and
   scrolling through 240 rows to find yours is worse than "Other" for anything not
   listed here. India first because that's who the site is for; the rest ordered by
   common bidder origin, not alphabetically (an alphabetical list still puts your
   country five screens down on a phone). If a country you need is missing, add it
   once here rather than in the two consumers. */
export const COUNTRIES = [
  { iso: 'IN', name: 'India', dial: '+91', flag: '🇮🇳' },
  { iso: 'US', name: 'United States', dial: '+1', flag: '🇺🇸' },
  { iso: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪' },
  { iso: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬' },
  { iso: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦' },
  { iso: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺' },
  { iso: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪' },
  { iso: 'FR', name: 'France', dial: '+33', flag: '🇫🇷' },
  { iso: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱' },
  { iso: 'IE', name: 'Ireland', dial: '+353', flag: '🇮🇪' },
  { iso: 'SE', name: 'Sweden', dial: '+46', flag: '🇸🇪' },
  { iso: 'CH', name: 'Switzerland', dial: '+41', flag: '🇨🇭' },
  { iso: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸' },
  { iso: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹' },
  { iso: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹' },
  { iso: 'PL', name: 'Poland', dial: '+48', flag: '🇵🇱' },
  { iso: 'NZ', name: 'New Zealand', dial: '+64', flag: '🇳🇿' },
  { iso: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵' },
  { iso: 'KR', name: 'South Korea', dial: '+82', flag: '🇰🇷' },
  { iso: 'CN', name: 'China', dial: '+86', flag: '🇨🇳' },
  { iso: 'HK', name: 'Hong Kong', dial: '+852', flag: '🇭🇰' },
  { iso: 'TW', name: 'Taiwan', dial: '+886', flag: '🇹🇼' },
  { iso: 'MY', name: 'Malaysia', dial: '+60', flag: '🇲🇾' },
  { iso: 'ID', name: 'Indonesia', dial: '+62', flag: '🇮🇩' },
  { iso: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭' },
  { iso: 'TH', name: 'Thailand', dial: '+66', flag: '🇹🇭' },
  { iso: 'VN', name: 'Vietnam', dial: '+84', flag: '🇻🇳' },
  { iso: 'PK', name: 'Pakistan', dial: '+92', flag: '🇵🇰' },
  { iso: 'BD', name: 'Bangladesh', dial: '+880', flag: '🇧🇩' },
  { iso: 'LK', name: 'Sri Lanka', dial: '+94', flag: '🇱🇰' },
  { iso: 'NP', name: 'Nepal', dial: '+977', flag: '🇳🇵' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦' },
  { iso: 'QA', name: 'Qatar', dial: '+974', flag: '🇶🇦' },
  { iso: 'KW', name: 'Kuwait', dial: '+965', flag: '🇰🇼' },
  { iso: 'IL', name: 'Israel', dial: '+972', flag: '🇮🇱' },
  { iso: 'TR', name: 'Turkey', dial: '+90', flag: '🇹🇷' },
  { iso: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦' },
  { iso: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷' },
  { iso: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽' },
  { iso: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷' },
];

/** Fallback for a country not on the list. `iso: ''` marks it as "no ISO chosen"
    so downstream code (and any future bookkeeping) can tell an intentional Other
    apart from the default India selection. */
export const OTHER_COUNTRY = { iso: '', name: 'Other', dial: '', flag: '🌐' };

/** Look up a country by ISO code, or by dial code as a fallback. Returns the India
    entry if nothing matches — a checkout that has to pick *some* default. */
export function findCountry(isoOrDial) {
  const key = String(isoOrDial || '').trim();
  return (
    COUNTRIES.find((c) => c.iso === key) ||
    COUNTRIES.find((c) => c.dial === key) ||
    COUNTRIES[0]
  );
}

/** E.164-ish normalisation: strip everything that isn't a digit and prefix the dial
    code. Not a full validator (that lives in Razorpay), just enough that what we
    store and send is one canonical string per bidder rather than "+91 98765 43210",
    "9876543210", "+919876543210" all landing as different values. */
export function toE164(dialCode, localNumber) {
  const digits = String(localNumber || '').replace(/\D+/g, '');
  const dial = String(dialCode || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  // If someone pasted the full "+91..." into the number field, don't double-prefix.
  if (digits.startsWith(dial.replace(/^\+/, ''))) return '+' + digits;
  return dial + digits;
}
