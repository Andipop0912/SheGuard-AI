import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from '../navigation/RootNavigator';
import { bootstrapSafetyCore } from './bootstrap';

export const App: React.FC = () => {
  useEffect(() => {
    bootstrapSafetyCore();
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
};

export default App;
