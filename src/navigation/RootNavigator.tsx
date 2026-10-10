import React, { useEffect, useRef, useState } from 'react';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../features/home/HomeScreen';
import { EmergencyScreen } from '../features/emergency/EmergencyScreen';
import { DiagnosticsScreen } from '../features/diagnostics/DiagnosticsScreen';
import { PlannedFeatureScreen } from '../features/placeholder/PlannedFeatureScreen';
import { RegisterScreen, SignInScreen } from '../features/auth/AuthScreens';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TrustedContactsScreen } from '../features/contacts/TrustedContactsScreen';
import { ContactFormScreen } from '../features/contacts/ContactFormScreen';
import { LiveLocationScreen } from '../features/location/LiveLocationScreen';
import { RouteSafetyScreen } from '../features/routesafety/RouteSafetyScreen';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { IncidentDetailsScreen } from '../features/history/IncidentDetailsScreen';
import { IncidentReportScreen } from '../features/history/IncidentReportScreen';
import { LegalHelpScreen } from '../features/help/LegalHelpScreen';
import { AskSheGuardScreen } from '../features/ask/AskSheGuardScreen';
import { useActivationStore } from '../activation/store/activationStore';
import { ActivationState } from '../activation/domain/ActivationState';
import { useEmergencyStore } from '../emergency/store/emergencyStore';
import { isOpenEmergencyState } from '../emergency/domain/EmergencyState';
import { colors, typography } from '../design/tokens';
import { Icon, IconName } from '../design/Icon';
import { MainTabParamList, MainTabScreenProps, RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, IconName> = {
  Home: 'home',
  History: 'history',
  LegalHelp: 'shield',
  Settings: 'tune',
};



const LegalHelpTab: React.FC<MainTabScreenProps<'LegalHelp'>> = () => <LegalHelpScreen />;

/** Bottom navigation (home_screen.dart): dark navy while Home is armed, white otherwise. */
const MainTabs: React.FC = () => {
  const isArmed = useActivationStore((s) => s.activationState === ActivationState.ACTIVE);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        // Tab bar styling comes from the focused screen's options, so this is dark only on Home.
        const dark = isArmed && route.name === 'Home';
        return {
          headerShown: false,
          tabBarActiveTintColor: colors.emergencyRed,
          tabBarInactiveTintColor: dark ? colors.textOnDarkMuted : colors.textMuted,
          tabBarStyle: {
            backgroundColor: dark ? colors.primaryNavyDark : colors.white,
            borderTopColor: dark ? colors.borderDark : colors.border,
          },
          tabBarLabelStyle: typography.tabLabel,
          tabBarIcon: ({ color, size }) => <Icon name={TAB_ICONS[route.name]} size={size} color={color} />,
        };
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="LegalHelp" component={LegalHelpTab} options={{ title: 'Legal Help' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

/**
 * Presents the Emergency screen whenever EmergencyCoordinator reports a newly opened emergency
 * (manual, voice, shake or hardware), and dismisses it when the emergency closes.
 * Navigation only follows emergency state; it never creates or delays one.
 */
export const EmergencyPresenter: React.FC<{ navigationReady: boolean }> = ({ navigationReady }) => {
  const currentEvent = useEmergencyStore((s) => s.currentEvent);
  const openEventId = currentEvent && isOpenEmergencyState(currentEvent.state) ? currentEvent.eventId : null;
  const presentedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!navigationReady || !navigationRef.isReady()) return;
    const onEmergency = navigationRef.getCurrentRoute()?.name === 'Emergency';
    if (openEventId && openEventId !== presentedFor.current) {
      presentedFor.current = openEventId;
      if (!onEmergency) navigationRef.navigate('Emergency');
    } else if (!openEventId) {
      presentedFor.current = null;
      if (onEmergency && navigationRef.canGoBack()) navigationRef.goBack();
    }
  }, [openEventId, navigationReady]);

  return null;
};

export const RootNavigator: React.FC = () => {
  const [navigationReady, setNavigationReady] = useState(false);
  return (
  <NavigationContainer ref={navigationRef} onReady={() => setNavigationReady(true)}>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen
        name="Emergency"
        component={EmergencyScreen}
        options={{ presentation: 'fullScreenModal', animation: 'fade' }}
      />
      <Stack.Screen
        name="Planned"
        component={PlannedFeatureScreen}
        options={{ headerShown: true, title: '', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ headerShown: true, title: '', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="LiveLocation"
        component={LiveLocationScreen}
        options={{ headerShown: true, title: 'Live Location', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="RouteSafety"
        component={RouteSafetyScreen}
        options={{ headerShown: true, title: 'Route Safety', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="AskSheGuard"
        component={AskSheGuardScreen}
        options={{ headerShown: true, title: 'Ask SheGuard', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="IncidentDetails"
        component={IncidentDetailsScreen}
        options={{ headerShown: true, title: 'Incident Details', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="IncidentReport"
        component={IncidentReportScreen}
        options={{ headerShown: true, title: 'Incident Report', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="TrustedContacts"
        component={TrustedContactsScreen}
        options={{ headerShown: true, title: '', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="ContactForm"
        component={ContactFormScreen}
        options={{ headerShown: true, title: '', headerTintColor: colors.primaryNavy }}
      />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ headerShown: true, title: '', headerTintColor: colors.primaryNavy }}
      />
      {__DEV__ && (
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ headerShown: true, title: 'Diagnostics' }} />
      )}
    </Stack.Navigator>
    <EmergencyPresenter navigationReady={navigationReady} />
  </NavigationContainer>
  );
};
