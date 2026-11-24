/**
 * Where support goes. Edit these links to switch payment methods on or off —
 * a method with an empty link is hidden on the Support page.
 */
import { REPO } from './shared';

const OWNER = REPO.split('/')[0];

export const SUPPORT = {
  /** GitHub Sponsors profile (monthly or one-off). Requires a GitHub Sponsors profile for the account. */
  githubSponsors: `https://github.com/sponsors/${OWNER}`,
  /** Paystack payment page, e.g. https://paystack.com/pay/vipad (cards, bank transfer, USSD, mobile money). */
  paystack: '',
  /** Flutterwave payment link, e.g. https://flutterwave.com/pay/vipad (cards, bank, mobile money, M-Pesa). */
  flutterwave: '',
  /**
   * Inbox for business sponsorship enquiries. When empty, the enquiry form opens a pre-filled
   * GitHub issue instead, so it works before an address is set.
   */
  businessEmail: '',
  /** GitHub issue form used when businessEmail is empty. */
  issueUrl: `https://github.com/${REPO}/issues/new`,
  repoUrl: `https://github.com/${REPO}`,
};
