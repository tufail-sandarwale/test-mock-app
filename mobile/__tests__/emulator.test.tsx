import React from 'react';
import { NativeModules, PermissionsAndroid } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = require('react-native');
  return {
    Map: View,
    Camera: View,
    ViewAnnotation: View,
    GeoJSONSource: View,
    Layer: View,
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const ready = {
  developerOptionsEnabled: true,
  mockAppSelected: true,
  permissionGranted: true,
  locationEnabled: true,
  notificationsEnabled: true,
};
const stopped = { state: 'stopped', timestamp: 0 };
const native = {
  start: jest.fn(),
  startRoute: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  steer: jest.fn(),
  moveTo: jest.fn(),
  getStatus: jest.fn(),
  getPrerequisites: jest.fn(),
  captureRealLocation: jest.fn(),
  openSystemSettings: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
NativeModules.MockLocation = native;

const { RootNavigator } =
  require('../src/navigation/RootNavigator') as typeof import('../src/navigation/RootNavigator');
const { useLocationStore, defaultSettings } =
  require('../src/store/useLocationStore') as typeof import('../src/store/useLocationStore');
const { useSimulationStore } =
  require('../src/store/useSimulationStore') as typeof import('../src/store/useSimulationStore');
const { usePreferencesStore } =
  require('../src/store/usePreferencesStore') as typeof import('../src/store/usePreferencesStore');
const { useSetupStore } =
  require('../src/store/useSetupStore') as typeof import('../src/store/useSetupStore');
const { resetSearchThrottle } =
  require('../src/services/geocoding') as typeof import('../src/services/geocoding');
const { DeveloperSetupScreen } =
  require('../src/screens/DeveloperSetupScreen') as typeof import('../src/screens/DeveloperSetupScreen');

let app: ReactTestRenderer.ReactTestRenderer;
const act = ReactTestRenderer.act;

const control = (label: string) =>
  app.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
const byLabel = (label: string) =>
  app.root.findAll(node => node.props.accessibilityLabel === label)[0];
const map = () =>
  app.root.findAll(
    node => typeof node.props.onRegionDidChange === 'function',
  )[0];

async function tap(label: string) {
  const node = control(label);
  expect(node).toBeDefined();
  await act(async () => node.props.onPress());
}

async function moveMap(latitude: number, longitude: number) {
  await act(async () => {
    map().props.onRegionWillChange({ nativeEvent: { userInteraction: true } });
    map().props.onRegionDidChange({
      nativeEvent: { center: [longitude, latitude], zoom: 15, bearing: 0 },
    });
  });
}

function setStatus(status: object) {
  return act(async () =>
    useSimulationStore
      .getState()
      .setStatus({ timestamp: 1, ...status } as never),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetSearchThrottle();
  await AsyncStorage.clear();
  native.start.mockResolvedValue({ state: 'starting', timestamp: 0 });
  native.startRoute.mockResolvedValue({ state: 'starting', timestamp: 0 });
  native.stop.mockResolvedValue(stopped);
  native.steer.mockResolvedValue({ state: 'running', timestamp: 1 });
  native.moveTo.mockResolvedValue({ state: 'running', timestamp: 1 });
  native.getStatus.mockResolvedValue(stopped);
  native.getPrerequisites.mockResolvedValue(ready);
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]: 'granted',
  } as never);
  useLocationStore.setState({
    selected: { latitude: 19, longitude: 72 },
    target: null,
    route: [],
    presets: [],
    savedRoutes: [],
    recent: [],
    settings: defaultSettings,
  });
  useSimulationStore.setState({
    status: stopped as never,
    busy: false,
    error: null,
    realLocation: null,
  });
  usePreferencesStore.setState({ mapStyle: 'streets', joystickSpeedKmh: 5 });
  useSetupStore.setState({ prerequisites: null, busy: false, error: null });
  await act(async () => {
    app = ReactTestRenderer.create(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );
  });
});

afterEach(async () => {
  await act(async () => app.unmount());
  jest.restoreAllMocks();
});

test('play mocks the pin location and the same button stops it', async () => {
  await tap('Start mocking');
  expect(native.start).toHaveBeenCalledWith(
    expect.objectContaining({
      latitude: 19,
      longitude: 72,
      speed: defaultSettings.speedKmh / 3.6,
    }),
  );
  expect(useLocationStore.getState().recent[0]).toMatchObject({
    latitude: 19,
    longitude: 72,
  });
  await setStatus({
    state: 'running',
    kind: 'point',
    location: { latitude: 19, longitude: 72, speed: 0, accuracy: 5 },
  });
  expect(control('Start mocking')).toBeUndefined();
  await tap('Stop mocking');
  expect(native.stop).toHaveBeenCalledTimes(1);
});

test('panning while mocking offers to move the mock without restarting', async () => {
  await setStatus({
    state: 'running',
    kind: 'point',
    location: { latitude: 19, longitude: 72, speed: 0, accuracy: 5 },
  });
  expect(control('📍 Move mock here')).toBeUndefined();
  await moveMap(19.01, 72.02);
  expect(
    control('Pin at 19.010000, 72.020000. Share coordinates'),
  ).toBeDefined();
  await tap('📍 Move mock here');
  expect(native.moveTo).toHaveBeenCalledWith(19.01, 72.02);
  expect(native.start).not.toHaveBeenCalled();
});

test('route mode adds tapped waypoints and drives them at the chosen speed', async () => {
  await tap('Route mode');
  expect(control('Start route').props.disabled).toBe(true);
  await act(async () => {
    map().props.onPress({ nativeEvent: { lngLat: [72, 19] } });
    map().props.onPress({ nativeEvent: { lngLat: [72.01, 19] } });
  });
  expect(useLocationStore.getState().route).toHaveLength(2);
  await tap('Car speed 50 km/h');
  await tap('Loop route');
  await tap('Start route');
  expect(native.startRoute).toHaveBeenCalledWith(
    expect.objectContaining({
      points: [
        { latitude: 19, longitude: 72 },
        { latitude: 19, longitude: 72.01 },
      ],
      speedKmh: 50,
      routeMode: 'loop',
    }),
  );
  await setStatus({ state: 'running', kind: 'route', progress: 25 });
  expect(control('Location mode').props.disabled).toBe(true);
  expect(control('Remove last waypoint').props.disabled).toBe(true);
});

test('joystick mode starts stationary and steers the running mock', async () => {
  await tap('Joystick mode');
  await tap('Joystick Bike speed 20 km/h');
  await tap('Start joystick');
  expect(native.start).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 19, longitude: 72, speed: 0 }),
  );
  expect(byLabel('Joystick')).toBeUndefined();
  await setStatus({
    state: 'running',
    kind: 'point',
    location: { latitude: 19, longitude: 72, speed: 0, accuracy: 5 },
  });
  const stick = byLabel('Joystick');
  expect(stick).toBeDefined();
  await act(async () => {
    stick.props.onAccessibilityAction({ nativeEvent: { actionName: 'east' } });
    await new Promise<void>(resolve => setTimeout(() => resolve(), 20));
  });
  expect(native.steer).toHaveBeenLastCalledWith(90, 20 / 3.6);
  await act(async () => {
    stick.props.onAccessibilityAction({ nativeEvent: { actionName: 'stop' } });
  });
  expect(native.steer).toHaveBeenLastCalledWith(90, 0);
});

test('typed coordinates move the pin without a network search', async () => {
  const fetchSpy = jest.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  const input = byLabel('Search places or coordinates');
  await act(async () => input.props.onChangeText('10.5, -20.25'));
  await act(async () => input.props.onSubmitEditing());
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(
    control('Pin at 10.500000, -20.250000. Share coordinates'),
  ).toBeDefined();
});

test('place search lists results and moves the pin to the chosen place', async () => {
  const fetchSpy = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [
      {
        place_id: 7,
        name: 'Gateway of India',
        display_name: 'Gateway of India, Mumbai, India',
        lat: '18.9220',
        lon: '72.8347',
      },
    ],
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  const input = byLabel('Search places or coordinates');
  await act(async () => input.props.onChangeText('Gateway of India'));
  await act(async () => input.props.onSubmitEditing());
  expect(fetchSpy.mock.calls[0][0]).toContain('q=Gateway%20of%20India');
  expect(fetchSpy.mock.calls[0][1].headers['User-Agent']).toContain(
    'MockGPSTester',
  );
  await tap('Go to Gateway of India');
  expect(control('Go to Gateway of India')).toBeUndefined();
  expect(
    control('Pin at 18.922000, 72.834700. Share coordinates'),
  ).toBeDefined();
  await tap('Start mocking');
  expect(useLocationStore.getState().recent[0].name).toBe('Gateway of India');
});

test('search failures are shown and dismissible', async () => {
  globalThis.fetch = jest
    .fn()
    .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  const input = byLabel('Search places or coordinates');
  await act(async () => input.props.onChangeText('Somewhere'));
  await act(async () => input.props.onSubmitEditing());
  expect(
    app.root.findAll(
      node =>
        node.props.accessibilityRole === 'alert' &&
        String(node.props.children).includes('Search is unavailable'),
    ).length,
  ).toBeGreaterThan(0);
});

test('the star saves the pin as a named favorite', async () => {
  await tap('Add to favorites');
  await act(async () => byLabel('Name').props.onChangeText('Home base'));
  await tap('Save');
  expect(useLocationStore.getState().presets).toEqual([
    expect.objectContaining({ name: 'Home base', latitude: 19, longitude: 72 }),
  ]);
  expect(control('Favorite: Home base')).toBeDefined();
});

test('an empty favorite name keeps the prompt open with an error', async () => {
  await tap('Add to favorites');
  await tap('Save');
  expect(useLocationStore.getState().presets).toHaveLength(0);
  expect(byLabel('Name')).toBeDefined();
});

test('map style switcher persists the chosen style', async () => {
  await tap('Map style');
  await tap('Satellite');
  expect(usePreferencesStore.getState().mapStyle).toBe('satellite');
  expect(typeof map().props.mapStyle).toBe('object');
  expect(map().props.mapStyle.sources.satellite.attribution).toContain('Esri');
});

test('long press offers location actions', async () => {
  await act(async () =>
    map().props.onLongPress({ nativeEvent: { lngLat: [72.5, 19.5] } }),
  );
  await tap('Set as radius target');
  expect(useLocationStore.getState().target).toEqual({
    latitude: 19.5,
    longitude: 72.5,
  });
  await act(async () =>
    map().props.onLongPress({ nativeEvent: { lngLat: [72.6, 19.6] } }),
  );
  await tap('Add route waypoint');
  expect(useLocationStore.getState().route).toEqual([
    { latitude: 19.6, longitude: 72.6 },
  ]);
  expect(control('Route mode').props.accessibilityState.selected).toBe(true);
});

test('incomplete device setup shows a fix banner', async () => {
  await act(async () => app.unmount());
  native.getPrerequisites.mockResolvedValue({
    ...ready,
    mockAppSelected: false,
  });
  await act(async () => {
    app = ReactTestRenderer.create(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );
  });
  await tap('Fix');
  expect(app.root.findAllByType(DeveloperSetupScreen)).toHaveLength(1);
});

test('mock-location errors link to device setup', async () => {
  native.start.mockRejectedValue(
    new Error('Mock location is not enabled for this application.'),
  );
  await tap('Start mocking');
  expect(useSimulationStore.getState().error).toContain('Mock location');
  await tap('Setup');
  expect(app.root.findAllByType(DeveloperSetupScreen)).toHaveLength(1);
});

test('superseded or cleared searches never leave a spinner or stale results', async () => {
  const pending: ((value: unknown) => void)[] = [];
  globalThis.fetch = jest.fn(
    () => new Promise(resolve => pending.push(resolve)),
  ) as unknown as typeof fetch;
  const response = {
    ok: true,
    status: 200,
    json: async () => [
      {
        place_id: 1,
        name: 'Paris',
        display_name: 'Paris',
        lat: '48.85',
        lon: '2.35',
      },
    ],
  };
  const input = () => byLabel('Search places or coordinates');
  await act(async () => input().props.onChangeText('Paris'));
  act(() => {
    input().props.onSubmitEditing();
  });
  expect(control('Search').props.accessibilityState.busy).toBe(true);
  await act(async () => input().props.onChangeText('40, -3'));
  await act(async () => input().props.onSubmitEditing());
  await act(async () => pending[0](response));
  expect(control('Search').props.accessibilityState.busy).toBe(false);
  expect(control('Go to Paris')).toBeUndefined();

  resetSearchThrottle();
  await act(async () => input().props.onChangeText('Paris'));
  act(() => {
    input().props.onSubmitEditing();
  });
  await tap('Clear search');
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    pending[1](response);
  });
  expect(control('Go to Paris')).toBeUndefined();
  expect(control('Search').props.accessibilityState.busy).toBe(false);
});

async function renderApp() {
  await act(async () => {
    app = ReactTestRenderer.create(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );
  });
}

test('a map that never reported back starts paused and loads on demand', async () => {
  await act(async () => app.unmount());
  await AsyncStorage.setItem('mock-gps-map-guard-v1', 'starting');
  await renderApp();
  expect(map()).toBeUndefined();
  expect(control('Load map')).toBeDefined();
  await tap('Start mocking');
  expect(native.start).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 19, longitude: 72 }),
  );
  await tap('Load map');
  expect(map()).toBeDefined();
  expect(map().props.androidView).toBe('texture');
});

test('the map startup guard clears once the map reports back', async () => {
  expect(await AsyncStorage.getItem('mock-gps-map-guard-v1')).toBe('starting');
  await act(async () => map().props.onDidFinishLoadingMap());
  expect(await AsyncStorage.getItem('mock-gps-map-guard-v1')).toBeNull();
  await act(async () => app.unmount());
  await renderApp();
  expect(map()).toBeDefined();
});

test('malformed map events are ignored instead of crashing', async () => {
  await act(async () => {
    map().props.onRegionDidChange({ nativeEvent: {} });
    map().props.onRegionDidChange({ nativeEvent: { center: [NaN, 1] } });
    map().props.onPress({ nativeEvent: {} });
    map().props.onLongPress({});
    map().props.onRegionWillChange({});
  });
  expect(
    control('Pin at 19.000000, 72.000000. Share coordinates'),
  ).toBeDefined();
  expect(byLabel('Set as radius target')).toBeUndefined();
});

test('ornament positions are whole numbers for the native Int32 props', async () => {
  const props = map().props;
  expect(Number.isInteger(props.attributionPosition.bottom)).toBe(true);
  expect(Number.isInteger(props.compassPosition.top)).toBe(true);
});

test('starting without mock-app setup guides to device setup instead of failing', async () => {
  const { Alert } = require('react-native');
  await act(async () => app.unmount());
  native.getPrerequisites.mockResolvedValue({
    ...ready,
    mockAppSelected: false,
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await renderApp();
    await tap('Start mocking');
    expect(native.start).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    const actions = alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => actions[1].onPress?.());
    expect(app.root.findAllByType(DeveloperSetupScreen)).toHaveLength(1);
  } finally {
    alert.mockRestore();
  }
});
