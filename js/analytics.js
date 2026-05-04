/**
 * Vercel Web Analytics initialization
 * ES5-compatible implementation for retro devices (iOS 12 Safari)
 * 
 * This file provides Vercel Web Analytics integration using a retro-compatible
 * approach that works on older browsers while leveraging @vercel/analytics package.
 */
(function() {
  'use strict';
  
  // Initialize the analytics queue if not already present
  // This allows tracking calls to be queued before the Vercel script loads
  function initQueue() {
    if (typeof window !== 'undefined' && !window.va) {
      window.va = function va() {
        var args = Array.prototype.slice.call(arguments);
        (window.vaq = window.vaq || []).push(args);
      };
    }
  }
  
  // Detect environment (production vs development)
  function detectEnvironment() {
    try {
      // Check if running on localhost
      if (window.location.hostname === 'localhost' || 
          window.location.hostname === '127.0.0.1' ||
          window.location.hostname === '') {
        return 'development';
      }
    } catch (e) {
      // Ignore errors
    }
    return 'production';
  }
  
  // Inject the Vercel Analytics script
  function injectAnalytics() {
    var env = detectEnvironment();
    var isDev = env === 'development';
    
    // Set mode on window
    window.vam = env;
    
    // Initialize queue
    initQueue();
    
    // The script URL - Vercel automatically serves this when Web Analytics is enabled
    var scriptSrc = isDev 
      ? 'https://va.vercel-scripts.com/v1/script.debug.js'
      : '/_vercel/insights/script.js';
    
    // Check if script is already injected
    var existingScript = document.head.querySelector('script[src*="' + scriptSrc + '"]');
    if (existingScript) {
      return;
    }
    
    // Create and inject the script element
    var script = document.createElement('script');
    script.src = scriptSrc;
    script.defer = true;
    
    // Error handling
    script.onerror = function() {
      var errorMessage = isDev
        ? 'Please check if any ad blockers are enabled and try again.'
        : 'Be sure to enable Web Analytics for your project in Vercel dashboard. See https://vercel.com/docs/analytics/quickstart';
      
      console.log('[Vercel Web Analytics] Failed to load script from ' + scriptSrc + '. ' + errorMessage);
    };
    
    // Log initialization in development
    if (isDev) {
      console.log('[Vercel Web Analytics] Initializing in development mode');
    }
    
    // Append script to head
    document.head.appendChild(script);
  }
  
  // Initialize analytics when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAnalytics);
  } else {
    injectAnalytics();
  }
})();
