/**
 * Vercel Web Analytics initialization
 * This file initializes Vercel Web Analytics for retro-compatible tracking.
 * 
 * The analytics script is automatically injected by Vercel when Web Analytics
 * is enabled in the Vercel dashboard. This initialization ensures the queue
 * is ready before the script loads.
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
  
  // Optional: Log analytics initialization in development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('[Analytics] Vercel Web Analytics initialized (development mode)');
  }
})();
