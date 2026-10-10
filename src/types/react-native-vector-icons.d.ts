// Minimal typing for the one icon family the app bundles (the package ships no TS types).
declare module 'react-native-vector-icons/MaterialIcons' {
  import { ComponentType } from 'react';
  import { StyleProp, TextStyle } from 'react-native';

  interface MaterialIconsProps {
    name: string;
    size?: number;
    color?: string;
    style?: StyleProp<TextStyle>;
    testID?: string;
  }

  const MaterialIcons: ComponentType<MaterialIconsProps>;
  export default MaterialIcons;
}
