import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.stocksense.app',
  appName: 'StockSense AI',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f766e',
  },
  plugins: {
    Keyboard: { resizeOnFullScreen: true },
    SystemBars: { insetsHandling: 'css' },
  },
};

export default config;
