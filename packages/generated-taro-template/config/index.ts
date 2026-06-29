import { defineConfig } from '@tarojs/cli';

export default defineConfig({
  projectName: 'atoms-mini-program',
  date: '2026-06-29',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5'],
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      }
    }
  },
  h5: {
    publicPath: './',
    staticDirectory: 'static',
    router: {
      mode: 'hash'
    }
  }
});
