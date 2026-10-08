import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor wraps the Vite build (dist/) in a native Android WebView app.
// After changing web code: `npm run android:sync` (vite build + cap sync).
const config: CapacitorConfig = {
  appId: 'com.yugiconcept.app',
  appName: 'YugiConcept',
  webDir: 'dist',
  android: {
    // Game assets are bundled; no mixed content / remote debugging needed in release.
    allowMixedContent: false,
    backgroundColor: '#1a1423',
  },
  plugins: {
    // Core plugin (Capacitor 8): exposes notch/cutout insets to CSS as --safe-area-inset-*.
    SystemBars: { insetsHandling: 'css' },
  },
};

export default config;
