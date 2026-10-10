import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Features not built yet in Phase 3A/3B; shown truthfully by PlannedFeatureScreen. */
export type PlannedFeature =
  | 'settings'
  | 'threatAnalysis';

/** Bottom tabs, in the order of home_screen.dart's BottomNavigationBar. */
export type MainTabParamList = {
  Home: undefined;
  History: undefined;
  LegalHelp: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  /** Presented automatically whenever an emergency is open (any trigger source). */
  Emergency: undefined;
  Planned: { feature: PlannedFeature };
  /** Developer diagnostics (the pre-Phase-3 screen). Registered in __DEV__ builds only. */
  Diagnostics: undefined;
  /** Account (Phase 3C). Only enables server backup; never required for SOS. */
  SignIn: undefined;
  Register: undefined;
  /** Trusted contacts (Phase 3D). Server-owned; requires sign-in. */
  TrustedContacts: undefined;
  /** Add (no contactId) or edit a trusted contact. */
  ContactForm: { contactId?: string };
  /** Live Location (Phase 3E): visualization of the existing location layer on Google Maps. */
  LiveLocation: undefined;
  /** Route Safety (Phase 3G): destination input + Google Maps route deep-link. */
  RouteSafety: undefined;
  /** Incident Details (Phase 3H): displays details of a specific historical emergency. */
  IncidentDetails: { eventId: string };
  /** Incident Report: a factual summary of one incident, generated from stored data only. */
  IncidentReport: { eventId: string };
  /** Ask SheGuard (Phase 3J): AI safety assistant chat screen. */
  AskSheGuard: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
