import React from 'react';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

/**
 * Material icon names used by the product UI. The Flutter design uses Icons.*_rounded;
 * these are the MaterialIcons equivalents (the only font bundled, see app/build.gradle.kts).
 */
export type IconName =
  | 'home'
  | 'history'
  | 'shield'
  | 'tune'
  | 'settings'
  | 'crisis-alert'
  | 'verified-user'
  | 'phone-android'
  | 'mic'
  | 'mic-off'
  | 'location-on'
  | 'location-off'
  | 'chevron-right'
  | 'chat-bubble-outline'
  | 'arrow-back'
  | 'close'
  | 'graphic-eq'
  | 'people-alt'
  | 'camera-alt'
  | 'security'
  | 'cloud-off'
  | 'cloud-done'
  | 'cloud-upload'
  | 'sync'
  | 'info-outline'
  | 'construction'
  | 'bug-report'
  | 'notifications-active'
  | 'person-add'
  | 'delete-outline'
  | 'add'
  | 'remove'
  | 'call'
  | 'fullscreen'
  | 'fullscreen-exit'
  | 'female'
  | 'gavel'
  | 'computer'
  | 'child-care'
  | 'map'
  | 'route'
  | 'my-location'
  | 'edit-location'
  | 'navigation'
  | 'check-circle'
  | 'check'
  | 'send'
  | 'flag'
  | 'local-hospital'
  | 'local-police'
  | 'local-fire-department'
  | 'play-arrow'
  | 'stop'
  | 'file-download'
  | 'picture-as-pdf';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  testID?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, color, testID }) => (
  <MaterialIcons name={name} size={size} color={color} testID={testID} />
);
