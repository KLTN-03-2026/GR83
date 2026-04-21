import { createContext, useContext, useMemo, useState } from 'react';
import { DA_NANG_AIRPORT } from '../data/defaultLocations';

const AppContext = createContext(null);

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  const lat = Number(position.lat);
  const lng = Number(position.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

export function createLocationRecord(label, details = {}) {
  return {
    label: normalizeText(label),
    position: normalizePosition(details.position),
    source: details.source ?? 'manual',
  };
}

export function AppProvider({ children }) {
  const [activeVehicle, setActiveVehicle] = useState('motorbike');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [route, setRoute] = useState({
    pickup: createLocationRecord(DA_NANG_AIRPORT.label, {
      position: DA_NANG_AIRPORT.position,
      source: 'default',
    }),
    destination: createLocationRecord(DA_NANG_AIRPORT.label, {
      position: DA_NANG_AIRPORT.position,
      source: 'default',
    }),
  });

  const swapRoute = () => {
    setRoute((current) => ({
      pickup: current.destination,
      destination: current.pickup,
    }));
  };

  const value = useMemo(
    () => ({
      activeVehicle,
      setActiveVehicle,
      scheduleEnabled,
      setScheduleEnabled,
      route,
      setRoute,
      swapRoute,
    }),
    [activeVehicle, route, scheduleEnabled],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }

  return context;
}
