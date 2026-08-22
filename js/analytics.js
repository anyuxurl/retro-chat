/**
 * Vercel Web Analytics — queue shim.
 *
 * This file is ONLY the buffer half of Vercel's plain-HTML snippet. It makes
 * va() safe to call before the tracker script has loaded; it does not track
 * anything by itself. The tracker is the separate
 * <script defer src="/_vercel/insights/script.js"> tag in index.html — and
 * it is not injected automatically for static sites (that only happens for
 * framework integrations like Next.js), which is why both tags must be
 * present. Analytics also has to be enabled once in the Vercel dashboard.
 */
(function() {
  'use strict';

  // Initialize the analytics queue if not already present
  // This allows tracking calls to be queued before the Vercel script loads
  if (typeof window !== 'undefined' && !window.va) {
    window.va = function va() {
      var args = Array.prototype.slice.call(arguments);
      (window.vaq = window.vaq || []).push(args);
    };
  }
})();
