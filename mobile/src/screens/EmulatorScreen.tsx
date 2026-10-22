import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useTheme } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  ViewAnnotation,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { circle } from '@turf/circle';
import { featureCollection, lineString, point } from '@turf/helpers';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { Coordinate, EmulatorMode } from '../types/location';
import { findPresetNear, useLocationStore } from '../store/useLocationStore';
import {
  simulationActions,
  useSimulationStore,
} from '../store/useSimulationStore';
import {
  joystickSpeeds,
  usePreferencesStore,
} from '../store/usePreferencesStore';
import { isReady, setupActions, useSetupStore } from '../store/useSetupStore';
import { nativeLocation } from '../services/MockLocation';
import { usePersistenceStatus } from '../services/localStorage';
import {
  parseCoordinates,
  searchPlaces,
  type Place,
} from '../services/geocoding';
import {
  distanceMeters,
  formatCoordinate,
  formatDistance,
  fromPosition,
  insideRadius,
  position,
  routeLengthMeters,
} from '../utils/geo';
import { mapStyleFor, mapStyles, type MapStyleId } from '../utils/mapStyles';
import { CrosshairPin } from '../components/CrosshairPin';
import { Joystick } from '../components/Joystick';
import {
  Chip,
  Icon,
  RoundButton,
  palette,
  useAccent,
} from '../components/MapControls';
import { BottomSheet, NamePrompt, SideDrawer } from '../components/Overlays';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  mapFailedLastTime,
  markMapHealthy,
  markMapStarting,
} from '../services/mapGuard';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export const DEFAULT_CENTER: Coordinate = {
  latitude: 19.076,
  longitude: 72.8777,
};
const DEFAULT_ZOOM = 15;
const ACTIVE_STATES = ['starting', 'running', 'paused'];
const routeSpeeds = [
  { label: 'Walk', speedKmh: 5 },
  { label: 'Bike', speedKmh: 15 },
  { label: 'Car', speedKmh: 50 },
];
const modes: { id: EmulatorMode; label: string }[] = [
  { id: 'point', label: '📍 Location' },
  { id: 'route', label: '🛣️ Route' },
  { id: 'joystick', label: '🕹️ Joystick' },
];

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${Math.max(minutes, 1)} min`;
}

const message = (problem: unknown) =>
  problem instanceof Error ? problem.message : String(problem);

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Validates a native [longitude, latitude] payload; map events can omit it. */
function coordinateFrom(value: unknown): Coordinate | null {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    return null;
  }
  return fromPosition(value as number[]);
}

function MapUnavailable({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction: () => void;
}) {
  const { colors } = useTheme();
  const accent = useAccent();
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.unavailable,
        { backgroundColor: colors.background },
      ]}
    >
      <View style={[styles.unavailableCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.unavailableTitle, { color: colors.text }]}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.unavailableDetail, { color: colors.text }]}>
            {detail}
          </Text>
        ) : (
          <ActivityIndicator color={accent} />
        )}
        {actionLabel ? (
          <Chip label={actionLabel} selected onPress={onAction} />
        ) : null}
      </View>
    </View>
  );
}

export function EmulatorScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  const store = useLocationStore();
  const { settings } = store;
  const { status, realLocation, busy, error } = useSimulationStore();
  const preferences = usePreferencesStore();
  const setup = useSetupStore(state => state.prerequisites);
  const storageError = usePersistenceStatus(state => state.error);

  const [mode, setMode] = useState<EmulatorMode>(route.params?.mode ?? 'point');
  const requestedMode = route.params?.mode;
  useEffect(() => {
    if (requestedMode) {
      setMode(requestedMode);
      navigation.setParams({ mode: undefined });
    }
  }, [requestedMode, navigation]);

  const active = ACTIVE_STATES.includes(status.state);
  const activeKind = active ? status.kind ?? 'point' : null;
  const simulated = status.location;
  useEffect(() => {
    if (activeKind === 'route') {
      setMode('route');
    } else if (activeKind === 'point') {
      setMode(current => (current === 'route' ? 'point' : current));
    }
  }, [activeKind]);

  const initial = useRef(store.selected ?? DEFAULT_CENTER).current;
  const view = useRef({ center: initial, zoom: DEFAULT_ZOOM, bearing: 0 });
  const centerRef = useRef(initial);
  const [center, setCenterState] = useState<Coordinate>(initial);
  const [mapBearing, setMapBearing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [follow, setFollow] = useState(false);
  const [placeName, setPlaceName] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [pressed, setPressed] = useState<Coordinate | null>(null);
  const [favoriteDraft, setFavoriteDraft] = useState<{
    coordinate: Coordinate;
    name: string;
  } | null>(null);
  const [routePromptOpen, setRoutePromptOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(220);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const cameraRef = useRef<CameraRef>(null);
  const searchRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setCenter = (coordinate: Coordinate) => {
    centerRef.current = coordinate;
    setCenterState(coordinate);
  };

  const moveCamera = useCallback(
    (
      coordinate: Coordinate,
      options: { zoom?: number; fly?: boolean } = {},
    ) => {
      const zoom = options.zoom ?? view.current.zoom;
      const stop = { center: position(coordinate), zoom };
      const camera = cameraRef.current;
      try {
        const animation = options.fly
          ? camera?.flyTo?.({ ...stop, duration: 1200 })
          : camera?.easeTo?.({ ...stop, duration: 500 });
        Promise.resolve(animation).catch(() => undefined);
      } catch {
        // The native camera is not mounted yet (map loading or paused);
        // the pin state below still updates and the map catches up later.
      }
      view.current = { ...view.current, center: coordinate, zoom };
      centerRef.current = coordinate;
      setCenterState(coordinate);
    },
    [],
  );

  // Map safe mode: if the map started last time but never reported back, the
  // device probably froze or crashed in the map, so wait for the user to retry.
  const [mapPhase, setMapPhase] = useState<'checking' | 'ready' | 'paused'>(
    'checking',
  );
  const mapHealthy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (await mapFailedLastTime()) {
        if (!cancelled) {
          setMapPhase('paused');
        }
        return;
      }
      await markMapStarting();
      if (!cancelled) {
        setMapPhase('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const reportMapHealthy = () => {
    if (!mapHealthy.current) {
      mapHealthy.current = true;
      markMapHealthy();
    }
  };
  const startMap = () => {
    setFailed(false);
    setLoaded(false);
    markMapStarting().finally(() => {
      if (mounted.current) {
        setMapPhase('ready');
      }
    });
  };

  // Locations chosen on other screens (favorites, coordinates) move the map.
  useEffect(() => {
    if (
      store.selected &&
      distanceMeters(store.selected, centerRef.current) > 1
    ) {
      moveCamera(store.selected, { fly: true });
    }
  }, [store.selected, moveCamera]);

  useEffect(() => {
    if (follow && active && simulated) {
      moveCamera(simulated);
    }
  }, [follow, active, simulated, moveCamera]);

  useEffect(() => {
    if (loaded || mapPhase !== 'ready') {
      return;
    }
    const timeout = setTimeout(() => {
      setFailed(true);
      setLoaded(true);
    }, 15000);
    return () => clearTimeout(timeout);
  }, [loaded, revision, mapPhase]);

  useFocusEffect(
    useCallback(() => {
      if (nativeLocation) {
        setupActions.refresh();
      }
    }, []),
  );

  /** Hides results and drops any in-flight search response. */
  const dismissSearch = () => {
    Keyboard.dismiss();
    searchRequest.current += 1;
    setSearching(false);
    setResults(null);
    setSearchError(null);
  };

  const runSearch = async () => {
    Keyboard.dismiss();
    const text = query.trim();
    if (!text) {
      return;
    }
    const coordinate = parseCoordinates(text);
    if (coordinate) {
      dismissSearch();
      setPlaceName(undefined);
      setFollow(false);
      moveCamera(coordinate, { zoom: 16, fly: true });
      return;
    }
    const request = ++searchRequest.current;
    setSearching(true);
    setSearchError(null);
    try {
      const places = await searchPlaces(text);
      if (mounted.current && request === searchRequest.current) {
        setResults(places);
        if (!places.length) {
          setSearchError(
            'No places found. Try another name or type latitude, longitude.',
          );
        }
      }
    } catch (problem) {
      if (mounted.current && request === searchRequest.current) {
        setResults(null);
        setSearchError(message(problem));
      }
    } finally {
      if (mounted.current && request === searchRequest.current) {
        setSearching(false);
      }
    }
  };

  const choosePlace = (place: Place) => {
    dismissSearch();
    setQuery(place.name);
    setPlaceName(place.name);
    setFollow(false);
    moveCamera(place, { zoom: 16, fly: true });
  };

  const handleMapPress = (coordinate: Coordinate) => {
    if (results || searchError) {
      dismissSearch();
      return;
    }
    Keyboard.dismiss();
    if (mode === 'route') {
      if (activeKind === 'route') {
        setNotice('Stop the route before editing waypoints.');
        return;
      }
      try {
        store.addWaypoint(coordinate);
      } catch (problem) {
        setNotice(message(problem));
      }
      return;
    }
    setFollow(false);
    setPlaceName(undefined);
    moveCamera(coordinate);
  };

  const steer = useCallback((bearing: number, speed: number) => {
    const current = useSimulationStore.getState().status;
    if (
      ['running', 'paused'].includes(current.state) &&
      current.kind !== 'route'
    ) {
      simulationActions.steer(bearing, speed);
    }
  }, []);

  // Android only applies a mock location once this app is the selected mock
  // app, so guide the user there instead of failing with a cryptic error.
  const ensureSetupOrGuide = () => {
    if (nativeLocation && setup && !isReady(setup)) {
      setupActions.refresh();
      Alert.alert(
        'One-time setup needed',
        'To place this location on your phone, Android needs you to choose Mock GPS Tester as the mock location app in Developer options. Android requires this and it cannot be skipped. Open the step-by-step setup now?',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open setup',
            onPress: () => navigation.navigate('DeveloperSetup'),
          },
        ],
      );
      return false;
    }
    return true;
  };

  const startOrStop = () => {
    dismissSearch();
    if (active) {
      setFollow(false);
      simulationActions.stop();
      return;
    }
    if (!ensureSetupOrGuide()) {
      return;
    }
    if (mode === 'route') {
      setFollow(true);
      simulationActions.startRoute();
      return;
    }
    setFollow(mode === 'joystick');
    simulationActions.startAt(centerRef.current, {
      joystick: mode === 'joystick',
      name: placeName,
    });
  };

  const locateMe = async () => {
    const before = useSimulationStore.getState().realLocation;
    setLocating(true);
    try {
      await simulationActions.captureReal();
    } finally {
      if (mounted.current) {
        setLocating(false);
      }
    }
    const real = useSimulationStore.getState().realLocation;
    if (real && real !== before && mounted.current) {
      setFollow(false);
      setPlaceName(undefined);
      moveCamera(real, { zoom: 17, fly: true });
    }
  };

  const favoriteHere = findPresetNear(store.presets, center);
  const toggleFavorite = () => {
    if (favoriteHere) {
      Alert.alert(favoriteHere.name, 'This place is in your favorites.', [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => store.deletePreset(favoriteHere.id),
        },
      ]);
      return;
    }
    setFavoriteDraft({ coordinate: centerRef.current, name: placeName ?? '' });
  };

  const saveFavorite = (name: string) => {
    if (!favoriteDraft) {
      return;
    }
    store.savePreset(name, {
      ...favoriteDraft.coordinate,
      accuracy: settings.accuracy,
      altitude: settings.altitude,
      bearing: settings.bearing,
      speed: settings.speedKmh / 3.6,
    });
    setFavoriteDraft(null);
    setNotice(`Saved “${name.trim()}” to favorites.`);
  };

  const changeStyle = (id: MapStyleId) => {
    if (id === preferences.mapStyle) {
      return;
    }
    preferences.setMapStyle(id);
    setLoaded(false);
    setFailed(false);
  };

  const shareCoordinate = (coordinate: Coordinate) =>
    Share.share({ message: formatCoordinate(coordinate) }).catch(
      () => undefined,
    );

  const updateRouteSpeed = (speedKmh: number) => {
    try {
      store.updateSettings({ ...settings, speedKmh });
    } catch (problem) {
      setNotice(message(problem));
    }
  };

  const mapStyle = mapStyleFor(preferences.mapStyle);
  const mapKey = `${preferences.mapStyle}-${revision}`;
  // Only read when the map mounts; a fresh object every render would churn native props.
  const initialViewState = useMemo(
    () => ({
      center: position(view.current.center),
      zoom: view.current.zoom,
      bearing: view.current.bearing,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapKey, mapPhase],
  );
  const waypoints = store.route;
  const loop = settings.routeMode === 'loop';
  const routeMeters =
    waypoints.length > 1 ? routeLengthMeters(waypoints, loop) : 0;
  const simulatedOffset =
    activeKind === 'point' && simulated ? distanceMeters(center, simulated) : 0;
  const canMoveHere =
    activeKind === 'point' && !!simulated && !follow && simulatedOffset > 3;
  const targetDistance =
    store.target && (simulated ?? center)
      ? distanceMeters(store.target, simulated ?? center)
      : null;
  const setupNeeded = !!nativeLocation && !!setup && !isReady(setup);
  const routeEditable = activeKind !== 'route';
  const mainDisabled = active
    ? !nativeLocation || busy
    : !nativeLocation || busy || (mode === 'route' && waypoints.length < 2);
  const mainLabel = active
    ? 'Stop mocking'
    : mode === 'route'
    ? 'Start route'
    : mode === 'joystick'
    ? 'Start joystick'
    : 'Start mocking';

  const title = (() => {
    if (!nativeLocation) {
      return 'Preview only';
    }
    switch (status.state) {
      case 'starting':
        return 'Starting…';
      case 'running':
        return activeKind === 'route'
          ? `Driving route · ${(status.progress ?? 0).toFixed(0)}%`
          : mode === 'joystick'
          ? 'Joystick active'
          : 'Mocking location';
      case 'paused':
        return 'Paused';
      case 'completed':
        return 'Completed';
      case 'error':
        return 'Stopped';
      default:
        return 'Ready';
    }
  })();

  const detail = (() => {
    if (!nativeLocation) {
      return 'Install the Android APK to mock locations.';
    }
    if (active && simulated) {
      const speed = `${(simulated.speed * 3.6).toFixed(1)} km/h`;
      return activeKind === 'route'
        ? `${formatDistance(status.remainingMeters ?? 0)} left · ${speed}`
        : `${formatCoordinate(simulated, 5)} · ${speed}`;
    }
    if (mode === 'route') {
      return waypoints.length < 2
        ? 'Tap the map to add at least 2 waypoints.'
        : `${waypoints.length} points · ${formatDistance(
            routeMeters,
          )} · ${formatDuration(routeMeters / (settings.speedKmh / 3.6))} at ${
            settings.speedKmh
          } km/h`;
    }
    if (mode === 'joystick') {
      return 'Start, then drag the joystick to walk or drive.';
    }
    return 'Move the map to place the pin, then press play.';
  })();

  const pressedActions = pressed
    ? [
        {
          label:
            activeKind === 'point' ? 'Move mock here' : 'Mock this location',
          disabled: activeKind === 'route' || !nativeLocation,
          onPress: () => {
            moveCamera(pressed);
            if (activeKind === 'point') {
              setFollow(false);
              simulationActions.moveHere(pressed);
            } else {
              if (!ensureSetupOrGuide()) {
                return;
              }
              const joystick = mode === 'joystick';
              setFollow(joystick);
              setMode(current => (current === 'route' ? 'point' : current));
              simulationActions.startAt(pressed, { joystick });
            }
          },
        },
        {
          label: 'Add to favorites',
          onPress: () => setFavoriteDraft({ coordinate: pressed, name: '' }),
        },
        {
          label: 'Add route waypoint',
          disabled: !routeEditable,
          onPress: () => {
            try {
              store.addWaypoint(pressed);
              setMode('route');
            } catch (problem) {
              setNotice(message(problem));
            }
          },
        },
        {
          label: 'Set as radius target',
          description: `Compare the mocked location with a ${settings.radiusMeters} m radius`,
          onPress: () => store.setTarget(pressed),
        },
        {
          label: 'Share coordinates',
          description: formatCoordinate(pressed),
          onPress: () => shareCoordinate(pressed),
        },
      ]
    : [];

  const banners: {
    key: string;
    text: string;
    tone: 'error' | 'warning' | 'info';
    action?: { label: string; onPress: () => void };
    onDismiss?: () => void;
  }[] = [];
  if (!nativeLocation) {
    banners.push({
      key: 'native',
      tone: 'warning',
      text: 'Native location service unavailable. Install the latest Android APK.',
    });
  }
  if (setupNeeded) {
    banners.push({
      key: 'setup',
      tone: 'warning',
      text: 'Device setup is needed before mocking locations.',
      action: {
        label: 'Fix',
        onPress: () => navigation.navigate('DeveloperSetup'),
      },
    });
  }
  if (error) {
    banners.push({
      key: 'error',
      tone: 'error',
      text: error,
      action:
        /mock location|developer options|permission|location services/i.test(
          error,
        )
          ? {
              label: 'Setup',
              onPress: () => navigation.navigate('DeveloperSetup'),
            }
          : undefined,
      onDismiss: () => useSimulationStore.setState({ error: null }),
    });
  }
  if (storageError) {
    banners.push({ key: 'storage', tone: 'error', text: storageError });
  }
  if (failed) {
    banners.push({
      key: 'map',
      tone: 'error',
      text: 'Map unavailable. Check your connection; coordinates still work.',
      action: {
        label: 'Retry Map',
        onPress: () => {
          setFailed(false);
          setLoaded(false);
          setRevision(value => value + 1);
        },
      },
    });
  }
  if (notice) {
    banners.push({
      key: 'notice',
      tone: 'info',
      text: notice,
      onDismiss: () => setNotice(null),
    });
  }

  const routeLine =
    waypoints.length > 1
      ? lineString(
          (loop ? [...waypoints, waypoints[0]] : waypoints).map(position),
        )
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {mapPhase === 'ready' ? (
        <ErrorBoundary
          key={mapKey}
          renderFallback={(report, reset) => (
            <MapUnavailable
              title="The map stopped working"
              detail={report.message}
              actionLabel="Reload map"
              onAction={() => {
                reset();
                setLoaded(false);
                setRevision(value => value + 1);
              }}
            />
          )}
        >
          <Map
            style={StyleSheet.absoluteFill}
            mapStyle={mapStyle.style}
            androidView="texture"
            logo={false}
            attributionPosition={{
              bottom: Math.round(panelHeight + 8),
              left: 8,
            }}
            compassPosition={{ top: Math.round(insets.top + 132), left: 12 }}
            onPress={event => {
              const coordinate = coordinateFrom(event?.nativeEvent?.lngLat);
              if (coordinate) {
                handleMapPress(coordinate);
              }
            }}
            onLongPress={event => {
              const coordinate = coordinateFrom(event?.nativeEvent?.lngLat);
              if (coordinate) {
                setPressed(coordinate);
              }
            }}
            onRegionWillChange={event => {
              if (event?.nativeEvent?.userInteraction) {
                setDragging(true);
                setFollow(false);
                setPlaceName(undefined);
              }
            }}
            onRegionDidChange={event => {
              reportMapHealthy();
              setDragging(false);
              const coordinate = coordinateFrom(event?.nativeEvent?.center);
              if (!coordinate) {
                return;
              }
              const zoom = finiteOr(event.nativeEvent.zoom, view.current.zoom);
              const bearing = finiteOr(event.nativeEvent.bearing, 0);
              view.current = { center: coordinate, zoom, bearing };
              setCenter(coordinate);
              setMapBearing(bearing);
            }}
            onDidFinishLoadingMap={() => {
              reportMapHealthy();
              setLoaded(true);
              setFailed(false);
            }}
            onDidFinishRenderingMap={reportMapHealthy}
            onDidFailLoadingMap={() => {
              reportMapHealthy();
              setFailed(true);
              setLoaded(true);
            }}
          >
            <Camera ref={cameraRef} initialViewState={initialViewState} />
            {store.target && (
              <GeoJSONSource
                id="radius"
                data={circle(position(store.target), settings.radiusMeters, {
                  units: 'meters',
                  steps: 96,
                })}
              >
                <Layer
                  id="radius-fill"
                  type="fill"
                  paint={{ 'fill-color': palette.target, 'fill-opacity': 0.15 }}
                />
                <Layer
                  id="radius-line"
                  type="line"
                  paint={{ 'line-color': palette.target, 'line-width': 2 }}
                />
              </GeoJSONSource>
            )}
            {routeLine && (
              <GeoJSONSource id="route" data={routeLine}>
                <Layer
                  id="route-casing"
                  type="line"
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                  paint={{ 'line-color': '#FFFFFF', 'line-width': 7 }}
                />
                <Layer
                  id="route-line"
                  type="line"
                  layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                  paint={{ 'line-color': palette.route, 'line-width': 4 }}
                />
              </GeoJSONSource>
            )}
            {waypoints.length > 0 && (
              <GeoJSONSource
                id="waypoints"
                data={featureCollection(
                  waypoints.map(item => point(position(item))),
                )}
              >
                <Layer
                  id="waypoint-dots"
                  type="circle"
                  paint={{
                    'circle-radius': 6,
                    'circle-color': palette.route,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#FFFFFF',
                  }}
                />
              </GeoJSONSource>
            )}
            {waypoints.length > 0 && (
              <ViewAnnotation
                id="route-start"
                lngLat={position(waypoints[0])}
                title="Route start"
              >
                <View
                  style={[styles.marker, { backgroundColor: palette.play }]}
                >
                  <Text style={styles.markerLabel}>A</Text>
                </View>
              </ViewAnnotation>
            )}
            {waypoints.length > 1 && (
              <ViewAnnotation
                id="route-end"
                lngLat={position(waypoints[waypoints.length - 1])}
                title="Route end"
              >
                <View
                  style={[styles.marker, { backgroundColor: palette.stop }]}
                >
                  <Text style={styles.markerLabel}>B</Text>
                </View>
              </ViewAnnotation>
            )}
            {store.target && (
              <ViewAnnotation
                id="target"
                lngLat={position(store.target)}
                title="Radius target"
              >
                <View
                  style={[styles.marker, { backgroundColor: palette.target }]}
                >
                  <Text style={styles.markerLabel}>T</Text>
                </View>
              </ViewAnnotation>
            )}
            {realLocation && (
              <ViewAnnotation
                id="real"
                lngLat={position(realLocation)}
                title="Captured real location"
              >
                <View style={[styles.dot, { backgroundColor: palette.real }]} />
              </ViewAnnotation>
            )}
            {simulated && (active || status.state === 'completed') && (
              <ViewAnnotation
                id="simulated"
                lngLat={position(simulated)}
                title="Mocked location"
              >
                <View style={styles.halo}>
                  <View
                    style={[styles.dot, { backgroundColor: palette.mock }]}
                  />
                </View>
              </ViewAnnotation>
            )}
          </Map>
        </ErrorBoundary>
      ) : (
        <MapUnavailable
          title={mapPhase === 'paused' ? 'Map paused' : 'Starting map…'}
          detail={
            mapPhase === 'paused'
              ? 'The map did not finish starting last time. Search, coordinates, favorites and mocking still work without it.'
              : undefined
          }
          actionLabel={mapPhase === 'paused' ? 'Load map' : undefined}
          onAction={startMap}
        />
      )}

      {mapPhase === 'ready' && <CrosshairPin lifted={dragging} />}
      {mapPhase === 'ready' && !loaded && (
        <ActivityIndicator
          style={styles.loading}
          color={accent}
          accessibilityLabel="Loading map"
        />
      )}

      <View
        style={[styles.top, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={[styles.searchBar, { backgroundColor: colors.card }]}>
          <RoundButton
            label="Open menu"
            size={40}
            style={styles.flat}
            onPress={() => {
              dismissSearch();
              setDrawerOpen(true);
            }}
          >
            <Icon name="menu" color={colors.text} />
          </RoundButton>
          <TextInput
            accessibilityLabel="Search places or coordinates"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            placeholder="Search place or lat, lng"
            placeholderTextColor="#8A8A8A"
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query ? (
            <RoundButton
              label="Clear search"
              size={36}
              style={styles.flat}
              onPress={() => {
                setQuery('');
                dismissSearch();
              }}
            >
              <Icon name="close" color={colors.text} size={16} />
            </RoundButton>
          ) : null}
          <RoundButton
            label="Search"
            size={40}
            style={styles.flat}
            busy={searching}
            disabled={!query.trim()}
            onPress={runSearch}
          >
            <Icon name="search" color={accent} size={20} />
          </RoundButton>
        </View>
        {(results || searchError) && (
          <View style={[styles.results, { backgroundColor: colors.card }]}>
            {searchError ? (
              <Text
                accessibilityRole="alert"
                style={[styles.resultError, { color: colors.text }]}
              >
                {searchError}
              </Text>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {(results ?? []).map(place => (
                <Pressable
                  key={place.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${place.name}`}
                  onPress={() => choosePlace(place)}
                  style={({ pressed: down }) => [
                    styles.result,
                    { borderBottomColor: colors.border },
                    down && { backgroundColor: colors.border },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.resultName, { color: colors.text }]}
                  >
                    {place.name}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.resultAddress, { color: colors.text }]}
                  >
                    {place.address}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[styles.credit, { color: colors.text }]}>
              Search by OpenStreetMap Nominatim
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Pin at ${formatCoordinate(
            center,
          )}. Share coordinates`}
          onPress={() => shareCoordinate(center)}
          style={[styles.coordinates, { backgroundColor: colors.card }]}
        >
          <Text
            style={[styles.coordinatesText, { color: colors.text }]}
            numberOfLines={1}
          >
            {placeName ? `${placeName} · ` : ''}
            {formatCoordinate(center)}
          </Text>
        </Pressable>
        {banners.map(banner => (
          <View
            key={banner.key}
            accessibilityRole="alert"
            style={[
              styles.banner,
              banner.tone === 'error'
                ? styles.bannerError
                : banner.tone === 'warning'
                ? styles.bannerWarning
                : styles.bannerInfo,
            ]}
          >
            <Text
              style={[
                styles.bannerText,
                banner.tone === 'warning'
                  ? styles.warningText
                  : styles.lightText,
              ]}
            >
              {banner.text}
            </Text>
            {banner.action && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={banner.action.label}
                onPress={banner.action.onPress}
                style={styles.bannerAction}
              >
                <Text
                  style={[
                    styles.bannerActionText,
                    banner.tone === 'warning'
                      ? styles.warningText
                      : styles.lightText,
                  ]}
                >
                  {banner.action.label.toUpperCase()}
                </Text>
              </Pressable>
            )}
            {banner.onDismiss && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss message"
                onPress={banner.onDismiss}
                hitSlop={8}
              >
                <Icon
                  name="close"
                  size={14}
                  color={
                    banner.tone === 'warning' ? palette.warningText : '#FFFFFF'
                  }
                />
              </Pressable>
            )}
          </View>
        ))}
        <View style={styles.sideButtons} pointerEvents="box-none">
          <RoundButton label="Map style" onPress={() => setStylesOpen(true)}>
            <Text style={styles.emoji}>🗺️</Text>
          </RoundButton>
          {active ? (
            <RoundButton
              label="Follow mocked location"
              selected={follow}
              disabled={!simulated}
              onPress={() => {
                setFollow(true);
                if (simulated) {
                  moveCamera(simulated);
                }
              }}
            >
              <Icon name="myLocation" color={palette.mock} />
            </RoundButton>
          ) : (
            <RoundButton
              label="Go to my real location"
              disabled={!nativeLocation || busy}
              busy={locating}
              onPress={locateMe}
            >
              <Icon name="myLocation" color={colors.text} />
            </RoundButton>
          )}
          <RoundButton
            label={
              favoriteHere
                ? `Favorite: ${favoriteHere.name}`
                : 'Add to favorites'
            }
            selected={!!favoriteHere}
            onPress={toggleFavorite}
          >
            <Text
              style={[
                styles.star,
                { color: favoriteHere ? palette.favorite : colors.text },
              ]}
            >
              {favoriteHere ? '★' : '☆'}
            </Text>
          </RoundButton>
        </View>
      </View>

      {mode === 'joystick' &&
        activeKind === 'point' &&
        status.state === 'running' && (
          <View style={[styles.joystick, { bottom: panelHeight + 16 }]}>
            <Joystick
              maxSpeedKmh={preferences.joystickSpeedKmh}
              mapBearing={mapBearing}
              onSteer={steer}
            />
          </View>
        )}

      <View
        onLayout={event => setPanelHeight(event.nativeEvent.layout.height)}
        style={[
          styles.panel,
          { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 },
        ]}
      >
        <View style={styles.modes} accessibilityRole="tablist">
          {modes.map(item => {
            const disabled =
              active &&
              (activeKind === 'route'
                ? item.id !== 'route'
                : item.id === 'route');
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityLabel={`${item.label.replace(/^\S+\s/, '')} mode`}
                accessibilityState={{ selected: mode === item.id, disabled }}
                disabled={disabled}
                onPress={() => setMode(item.id)}
                style={[
                  styles.mode,
                  mode === item.id && { backgroundColor: accent },
                  disabled && styles.disabled,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.modeLabel,
                    { color: mode === item.id ? colors.card : colors.text },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.statusRow}>
          <View style={styles.flex}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              {title}
            </Text>
            <Text
              style={[styles.statusDetail, { color: colors.text }]}
              numberOfLines={2}
            >
              {detail}
            </Text>
            {targetDistance !== null && (
              <Text style={[styles.statusDetail, { color: colors.text }]}>
                Target: {formatDistance(targetDistance)} ·{' '}
                {insideRadius(
                  targetDistance,
                  settings.radiusMeters,
                  settings.includeBoundary,
                )
                  ? 'INSIDE'
                  : 'OUTSIDE'}{' '}
                {settings.radiusMeters} m
              </Text>
            )}
          </View>
          {(status.state === 'running' || status.state === 'paused') && (
            <RoundButton
              label={status.state === 'paused' ? 'Resume' : 'Pause'}
              size={48}
              disabled={busy}
              onPress={
                status.state === 'paused'
                  ? simulationActions.resume
                  : simulationActions.pause
              }
            >
              <Icon
                name={status.state === 'paused' ? 'play' : 'pause'}
                color={colors.text}
                size={20}
              />
            </RoundButton>
          )}
          <RoundButton
            label={mainLabel}
            size={64}
            disabled={mainDisabled}
            backgroundColor={active ? palette.stop : palette.play}
            onPress={startOrStop}
          >
            <Icon name={active ? 'stop' : 'play'} color="#FFFFFF" size={28} />
          </RoundButton>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {canMoveHere && (
            <Chip
              label="📍 Move mock here"
              tone="primary"
              disabled={busy}
              onPress={() =>
                simulationActions.moveHere(centerRef.current, placeName)
              }
            />
          )}
          {mode === 'point' && (
            <>
              <Chip
                label="Coordinates…"
                onPress={() => navigation.navigate('LocationDetails')}
              />
              {store.target ? (
                <Chip label="Clear target" onPress={store.clearTarget} />
              ) : (
                <Chip
                  label="Set target here"
                  onPress={() => store.setTarget(centerRef.current)}
                />
              )}
              <Chip
                label="Favorites"
                onPress={() => navigation.navigate('SavedLocations')}
              />
            </>
          )}
          {mode === 'route' && (
            <>
              <Chip
                label="+ Pin"
                accessibilityLabel="Add pin location as waypoint"
                disabled={!routeEditable}
                onPress={() => {
                  try {
                    store.addWaypoint(centerRef.current);
                  } catch (problem) {
                    setNotice(message(problem));
                  }
                }}
              />
              <Chip
                label="Undo"
                accessibilityLabel="Remove last waypoint"
                disabled={!routeEditable || !waypoints.length}
                onPress={() => store.replaceRoute(waypoints.slice(0, -1))}
              />
              <Chip
                label="Clear"
                accessibilityLabel="Clear waypoints"
                disabled={!routeEditable || !waypoints.length}
                onPress={store.clearRoute}
              />
              {routeSpeeds.map(item => (
                <Chip
                  key={item.label}
                  label={`${item.label} ${item.speedKmh}`}
                  accessibilityLabel={`${item.label} speed ${item.speedKmh} km/h`}
                  selected={settings.speedKmh === item.speedKmh}
                  disabled={!routeEditable}
                  onPress={() => updateRouteSpeed(item.speedKmh)}
                />
              ))}
              {!routeSpeeds.some(
                item => item.speedKmh === settings.speedKmh,
              ) && (
                <Chip
                  label={`${settings.speedKmh} km/h`}
                  selected
                  onPress={() => navigation.navigate('Settings')}
                />
              )}
              <Chip
                label="Loop"
                accessibilityLabel="Loop route"
                selected={loop}
                disabled={!routeEditable}
                onPress={() => {
                  try {
                    store.updateSettings({
                      ...settings,
                      routeMode: loop ? 'once' : 'loop',
                    });
                  } catch (problem) {
                    setNotice(message(problem));
                  }
                }}
              />
              <Chip
                label="Save"
                accessibilityLabel="Save route"
                disabled={waypoints.length < 2}
                onPress={() => setRoutePromptOpen(true)}
              />
              <Chip
                label="Saved routes"
                onPress={() => navigation.navigate('Routes')}
              />
            </>
          )}
          {mode === 'joystick' &&
            joystickSpeeds.map(item => (
              <Chip
                key={item.label}
                label={`${item.label} ${item.speedKmh}`}
                accessibilityLabel={`Joystick ${item.label} speed ${item.speedKmh} km/h`}
                selected={preferences.joystickSpeedKmh === item.speedKmh}
                onPress={() => preferences.setJoystickSpeed(item.speedKmh)}
              />
            ))}
        </ScrollView>
      </View>

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Mock GPS Tester"
        subtitle={active ? `Simulation ${status.state}` : 'Simulation stopped'}
        footer="Only test devices and apps you are authorized to test."
        items={[
          {
            icon: '⭐',
            label: 'Favorites & history',
            onPress: () => navigation.navigate('SavedLocations'),
          },
          {
            icon: '🛣️',
            label: 'Saved routes',
            onPress: () => navigation.navigate('Routes'),
          },
          {
            icon: '⌨️',
            label: 'Enter coordinates',
            onPress: () => navigation.navigate('LocationDetails'),
          },
          {
            icon: '📊',
            label: 'Simulation status',
            onPress: () => navigation.navigate('Status'),
          },
          {
            icon: '⚙️',
            label: 'Settings',
            onPress: () => navigation.navigate('Settings'),
          },
          {
            icon: '🛠️',
            label: 'Device setup',
            badge: setupNeeded ? 'Action needed' : undefined,
            onPress: () => navigation.navigate('DeveloperSetup'),
          },
          {
            icon: '☁️',
            label: 'Cloud presets',
            onPress: () => navigation.navigate('Cloud'),
          },
        ]}
      />
      <BottomSheet
        visible={stylesOpen}
        title="Map style"
        onClose={() => setStylesOpen(false)}
        options={mapStyles.map(option => ({
          label: option.label,
          description:
            option.id === 'satellite'
              ? 'Esri World Imagery'
              : 'OpenFreeMap · OpenStreetMap',
          selected: option.id === preferences.mapStyle,
          onPress: () => changeStyle(option.id),
        }))}
      />
      <BottomSheet
        visible={!!pressed}
        title={pressed ? formatCoordinate(pressed) : ''}
        onClose={() => setPressed(null)}
        options={pressedActions}
      />
      <NamePrompt
        visible={!!favoriteDraft}
        title="Add to favorites"
        message={
          favoriteDraft ? formatCoordinate(favoriteDraft.coordinate) : undefined
        }
        initialValue={favoriteDraft?.name}
        onCancel={() => setFavoriteDraft(null)}
        onSubmit={saveFavorite}
      />
      <NamePrompt
        visible={routePromptOpen}
        title="Save route"
        message={`${waypoints.length} waypoints · ${formatDistance(
          routeMeters,
        )}`}
        onCancel={() => setRoutePromptOpen(false)}
        onSubmit={name => {
          store.saveRoute(name);
          setRoutePromptOpen(false);
          setNotice(`Saved route “${name.trim()}”.`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  unavailable: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  unavailableCard: {
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    alignItems: 'center',
    elevation: 4,
  },
  unavailableTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  unavailableDetail: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  flex: { flex: 1 },
  flat: { elevation: 0, shadowOpacity: 0 },
  disabled: { opacity: 0.4 },
  loading: { position: 'absolute', alignSelf: 'center', top: '50%' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 6,
    minHeight: 52,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, fontSize: 16, paddingHorizontal: 8, minHeight: 48 },
  results: {
    borderRadius: 16,
    maxHeight: 320,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  result: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: { fontSize: 16, fontWeight: '600' },
  resultAddress: { fontSize: 13, opacity: 0.75 },
  resultError: { fontSize: 14, padding: 16 },
  credit: { fontSize: 11, opacity: 0.6, padding: 8, textAlign: 'right' },
  coordinates: {
    alignSelf: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '90%',
    elevation: 3,
  },
  coordinatesText: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    elevation: 4,
  },
  bannerError: { backgroundColor: palette.errorBackground },
  bannerWarning: { backgroundColor: palette.warningBackground },
  bannerInfo: { backgroundColor: palette.infoBackground },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20 },
  warningText: { color: palette.warningText },
  lightText: { color: '#FFFFFF' },
  bannerAction: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bannerActionText: { fontSize: 14, fontWeight: '700' },
  sideButtons: { alignSelf: 'flex-end', gap: 12, marginTop: 4 },
  emoji: { fontSize: 20 },
  star: { fontSize: 24, lineHeight: 28 },
  joystick: { position: 'absolute', left: 16 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 12,
    elevation: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
  modes: { flexDirection: 'row', gap: 6 },
  mode: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  modeLabel: { fontSize: 14, fontWeight: '600', letterSpacing: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusTitle: { fontSize: 18, fontWeight: '700', letterSpacing: 0 },
  statusDetail: { fontSize: 13, opacity: 0.8, marginTop: 2 },
  chips: { gap: 8, paddingRight: 8 },
  marker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerLabel: { color: '#FFFFFF', fontWeight: '700' },
  halo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(26,115,232,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
});
