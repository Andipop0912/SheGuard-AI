import '@testing-library/react-native/extend-expect';

// Mock AsyncStorage for unit tests
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Navigation / layout native modules.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-vector-icons/MaterialIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...rest }) => React.createElement(Text, rest, name);
});

// Google Maps: native views replaced by plain Views that record their props; the camera method
// is a spy so tests can check centering behaviour.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const animateToRegion = jest.fn();
  const MapView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion }));
    return React.createElement(View, { ...props, testID: props.testID ?? 'map-view' }, props.children);
  });
  MapView.animateToRegionMock = animateToRegion;
  const Marker = (props) => React.createElement(View, props);
  const Circle = (props) => React.createElement(View, props);
  return { __esModule: true, default: MapView, Marker, Circle, PROVIDER_GOOGLE: 'google' };
});

// Repositories persist through the AsyncStorage mock; isolate every test.
beforeEach(async () => {
  await require('@react-native-async-storage/async-storage').clear();
});
