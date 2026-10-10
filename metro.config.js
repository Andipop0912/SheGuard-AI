const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration (React Native 0.76 default).
 * https://reactnative.dev/docs/metro
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
