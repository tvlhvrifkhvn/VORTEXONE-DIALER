// The active campaign ("file"), remembered per browser. lib/api.js sends it
// as the X-Campaign-Id header on every request (docs/CRM_PLAN.md section 3).
// The campaign switcher (phase C1E) calls setCampaignId.
const KEY = 'vortex.campaign';
const DEFAULT_ID = '1'; // File 01

export function getCampaignId() {
  try {
    const value = localStorage.getItem(KEY);
    return value && /^[1-9][0-9]*$/.test(value) ? value : DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}

export function setCampaignId(id) {
  try {
    localStorage.setItem(KEY, String(id));
  } catch {
    /* storage unavailable: the default file is used */
  }
}

export const DEFAULT_CAMPAIGN_ID = DEFAULT_ID;
